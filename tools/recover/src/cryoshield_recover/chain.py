"""VaultRegistry reads over several untrusted public RPCs.

Trust model: an RPC can lie by withholding, by adding junk, or by serving an OLDER genuine blob (which
still decrypts). We query every usable RPC and take the union of vault IDs; AES-GCM and the vaultId
binding reject forgeries and clones. Against rollback (audit REC-M1, change harden-recovery-network-trust):
a copy is "current" only with a quorum of distinct RPCs returning it and no disagreement, or when it
matches the latest event hash that several RPCs agree on. Self-reported versions are never trusted.
"""

from __future__ import annotations

import statistics
import time
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from urllib.parse import urlparse

from . import abi
from .candidates import Candidate, Freshness
from .keccak import keccak256
from .rpc import JsonRpcClient, RpcError, hex_to_bytes, hex_to_int

ClientFactory = Callable[[str], JsonRpcClient]


# eth_getLogs paging. Public RPCs cap block ranges (drpc rejects 50k with HTTP 400), so pages start at
# 10k blocks and are halved per RPC on a range-limit error, down to MIN_LOG_CHUNK, before giving up.
DEFAULT_LOG_CHUNK = 10_000
MIN_LOG_CHUNK = 64  # drpc's free plan accepts only ~100-block ranges (live, 2026-10-02)
MAX_LOG_PAGES = 2_000
# Once an RPC forced the page size below log_chunk, allow at most this many remaining pages: a
# tiny-range RPC (drpc free plan ~100 blocks) would otherwise page for the whole deadline.
MAX_ADAPTED_PAGES = 200
_RANGE_WORDS = ("range", "too many", "limit", "exceed", "too large", "block")
# One history lookup (all RPCs, all pages) may take at most this long (audit REC-L1).
HISTORY_DEADLINE = 60.0
# An RPC whose head differs from the median of usable RPCs by more than this is refused for history.
HEAD_TOLERANCE = 5_000


_DEFAULT_PORTS = {"https": 443, "http": 80}


def normalize_url(url: str) -> str:
    """Canonical endpoint identity for counting distinct RPCs (quorum AND support use this):
    lower-case scheme and host, no trailing dot, default port dropped, no trailing slash, query kept.
    Two paths on one host are two endpoints."""
    p = urlparse(url.strip())
    scheme = p.scheme.lower()
    host = (p.hostname or "").rstrip(".").lower()
    if ":" in host:
        host = f"[{host}]"
    try:
        port = p.port
    except ValueError:
        port = None
    netloc = host if port in (None, _DEFAULT_PORTS.get(scheme)) else f"{host}:{port}"
    path = p.path.rstrip("/")
    return f"{scheme}://{netloc}{path}" + (f"?{p.query}" if p.query else "")


def distinct_urls(urls: Sequence[str]) -> list[str]:
    seen: dict[str, str] = {}
    for u in urls:
        seen.setdefault(normalize_url(u), u)
    return list(seen.values())


def is_range_error(e: RpcError) -> bool:
    """An RPC refusing the eth_getLogs block range (as opposed to failing for another reason)."""
    if e.http_status in (400, 413):
        return True
    if e.code == -32005:  # "limit exceeded" (EIP-1474)
        return True
    text = str(e).lower()
    return e.code in (-32600, -32602, -32000, -32001) and any(w in text for w in _RANGE_WORDS)


def _hex(b: bytes) -> str:
    return "0x" + b.hex()


class Registry:
    def __init__(
        self,
        urls: Sequence[str],
        address: str,
        chain_id: int,
        deploy_block: int = 0,
        *,
        client_factory: ClientFactory = JsonRpcClient,
        log_chunk: int = DEFAULT_LOG_CHUNK,
        max_log_pages: int = MAX_LOG_PAGES,
    ) -> None:
        self.address = address.lower()
        self.chain_id = chain_id
        self.deploy_block = deploy_block
        self.log_chunk = log_chunk
        self.max_log_pages = max_log_pages
        self.warnings: list[str] = []
        # Duplicate URLs count once toward any quorum (REC-M1).
        self._all = [client_factory(u) for u in distinct_urls(urls)]
        self._usable: list[JsonRpcClient] | None = None
        self._history: dict[bytes, list[tuple[int, bytes]] | None] = {}
        # One history budget per Registry run (all vault ids, heads and pages), and cached heads.
        self._deadline: float | None = None
        self._heads: list[tuple[JsonRpcClient, int]] | None = None

    @property
    def quorum(self) -> int:
        """Distinct configured RPCs that must agree: min(2, distinct configured)."""
        return min(2, len(self._all))

    # ------------------------------------------------------------------ connection
    def usable(self) -> list[JsonRpcClient]:
        if self._usable is None:

            def probe(c: JsonRpcClient) -> JsonRpcClient | None:
                try:
                    got = hex_to_int(c.call("eth_chainId", []))
                except RpcError as e:
                    self.warnings.append(f"RPC {c.host} unavailable ({e})")
                    return None
                if got != self.chain_id:
                    self.warnings.append(
                        f"RPC {c.host} is on chain {got}, expected {self.chain_id}; ignored "
                        "(if this server is for another chain, pass --chain-id or --network)"
                    )
                    return None
                return c

            self._usable = [c for c in self._map(probe, self._all) if c is not None]
        return self._usable

    def _map(self, fn: Callable[[Any], Any], items: Sequence[Any], default: Any = None) -> list[Any]:
        """Run ``fn`` per RPC in parallel. Any unexpected failure of one RPC is contained: it becomes a
        warning and ``default`` for that RPC, never an exception that stops recovery."""
        if not items:
            return []

        def safe(item: Any) -> Any:
            try:
                return fn(item)
            except Exception as e:  # noqa: BLE001 - one hostile RPC must never stop recovery
                self.warnings.append(
                    f"RPC {getattr(item, 'host', '?')}: unexpected response ({type(e).__name__}); ignored"
                )
                return default

        with ThreadPoolExecutor(max_workers=min(8, len(items))) as ex:
            return list(ex.map(safe, items))

    def _eth_call(self, c: JsonRpcClient, data: bytes) -> bytes:
        res = c.call("eth_call", [{"to": self.address, "data": _hex(data)}, "latest"])
        return hex_to_bytes(res, max_len=c.max_bytes)

    # ------------------------------------------------------------------ lookups
    def resolve(self, locators: Sequence[bytes]) -> list[bytes]:
        """Union of candidate vaultIds for all locators across all usable RPCs, first-seen order."""

        def one(c: JsonRpcClient) -> list[bytes]:
            out: list[bytes] = []
            for loc in locators:
                try:
                    raw = self._eth_call(c, abi.encode_call(abi.SEL_RESOLVE_LOCATOR, loc))
                    out.extend(abi.decode_bytes32_array(raw))
                except (RpcError, abi.AbiError) as e:
                    self.warnings.append(f"RPC {c.host}: discarded resolveLocator answer ({e})")
            return out

        seen: dict[bytes, None] = {}
        for ids in self._map(one, self.usable(), []):
            for vid in ids:
                if any(vid):
                    seen.setdefault(vid, None)
        return list(seen)

    def fetch(self, vault_ids: Sequence[bytes]) -> list[Candidate]:
        """getVault for each id from every usable RPC. Each distinct (vaultId, blob) becomes ONE
        candidate whose ``support`` is the number of distinct RPCs that returned it."""

        def one(c: JsonRpcClient) -> list[tuple[str, bytes, bytes, int]]:
            out: list[tuple[str, bytes, bytes, int]] = []
            for vid in vault_ids:
                try:
                    raw = self._eth_call(c, abi.encode_call(abi.SEL_GET_VAULT, vid))
                    _owner, blob, version = abi.decode_vault(raw)
                except (RpcError, abi.AbiError) as e:
                    self.warnings.append(f"RPC {c.host}: discarded getVault answer ({e})")
                    continue
                if blob:
                    out.append((normalize_url(getattr(c, "url", c.host)), vid, blob, version))
            return out

        # Support is counted by normalised endpoint, exactly like the quorum (ECC review, PR #22).
        endpoints: dict[tuple[bytes, bytes], list[str]] = {}
        versions: dict[tuple[bytes, bytes], int] = {}
        for answers in self._map(one, self.usable(), []):
            for endpoint, vid, blob, version in answers:
                key = (vid, blob)
                if endpoint not in endpoints.setdefault(key, []):
                    endpoints[key].append(endpoint)
                versions.setdefault(key, version)  # display only, never used for ranking
        hosts = {k: [urlparse(e).netloc or e for e in v] for k, v in endpoints.items()}
        result = [
            Candidate(
                blob,
                "chain",
                ", ".join(hs),
                vid,
                versions[(vid, blob)],
                Freshness.UNVERIFIABLE,
                support=len(hs),
            )
            for (vid, blob), hs in hosts.items()
        ]
        self._reconcile(result)
        return result

    def _reconcile(self, cands: list[Candidate]) -> None:
        """Decide freshness per vault ID (REC-M1).

        * One distinct blob returned by at least ``quorum`` distinct RPCs, and no other blob: current.
        * Otherwise (disagreement, or too few answers): compare with the LATEST event hash agreed by
          several RPCs; a match is current, others are outdated/unmatched; without an agreed history every
          copy is unverifiable. A single liar can therefore never get an old copy labelled current.
        """
        groups: dict[bytes, list[Candidate]] = {}
        for c in cands:
            if c.vault_id is not None:
                groups.setdefault(c.vault_id, []).append(c)
        for vid, group in groups.items():
            if len(group) == 1 and group[0].support >= self.quorum:
                group[0].freshness = Freshness.CURRENT
                continue
            hashes = self.event_hashes(vid)
            for c in group:
                fresh = classify(c.blob, hashes)
                c.freshness = Freshness.CURRENT if fresh is Freshness.VERIFIED else fresh
            if len(group) == 1:
                if group[0].freshness is not Freshness.CURRENT:
                    self.warnings.append(
                        f"only {group[0].support} of {len(self._all)} blockchain servers returned vault "
                        f"0x{vid.hex()}, and its on-chain history could not be confirmed: it may not be "
                        "the latest version. Retry later or use --rpc with a server you trust."
                    )
            elif hashes:
                self.warnings.append(
                    f"SECURITY: blockchain servers disagree about vault 0x{vid.hex()} "
                    f"({len(group)} different copies). Using the copy that matches the latest on-chain "
                    "record; another server may be stale or lying."
                )
            else:
                self.warnings.append(
                    f"SECURITY: blockchain servers disagree about vault 0x{vid.hex()} "
                    f"({len(group)} different copies) and its on-chain history could not be confirmed. "
                    "Preferring the copy most servers returned; it may not be the latest. Retry later or "
                    "use --rpc with a server you trust."
                )

    # ------------------------------------------------------------------ events
    def event_hashes(self, vault_id: bytes) -> list[tuple[int, bytes]] | None:
        """(version, keccak256(blob)) for every VaultCreated/VaultUpdated of ``vault_id``.

        Asked of every usable RPC; at least two must answer (or the only one configured) and all
        answers must agree exactly. Otherwise None: the history is unverifiable, never guessed.
        Results are cached per vault.
        """
        if vault_id in self._history:
            return self._history[vault_id]
        if self._deadline is None:
            self._deadline = time.monotonic() + HISTORY_DEADLINE
        deadline = self._deadline
        if time.monotonic() > deadline:
            self.warnings.append(
                f"history of vault 0x{vault_id.hex()}: lookup deadline exceeded; cannot confirm which "
                "version is current"
            )
            self._history[vault_id] = None
            return None
        clients = self._plausible_heads(self.usable(), deadline)

        def one(item: tuple[JsonRpcClient, int]) -> list[tuple[int, bytes]] | None:
            c, to_block = item
            try:
                return self._logs(c, vault_id, to_block, deadline)
            except (RpcError, abi.AbiError) as e:
                self.warnings.append(f"RPC {c.host}: event history unavailable ({e})")
                return None

        answers = [a for a in self._map(one, clients) if a is not None]
        # Count CONFIGURED RPCs, not merely reachable ones: if only 1 of 3 answers, that single answer
        # is unconfirmed (the others may be down because someone wants exactly that).
        need = self.quorum
        result: list[tuple[int, bytes]] | None
        if not clients or len(answers) < need:
            if self._all:
                self.warnings.append(
                    f"history of vault 0x{vault_id.hex()}: only {len(answers)} of {len(self._all)} servers "
                    "answered; cannot confirm which version is current"
                )
            result = None
        elif any(a != answers[0] for a in answers[1:]):
            self.warnings.append(
                f"SECURITY: blockchain servers disagree about the history of vault 0x{vault_id.hex()}; "
                "treating it as unverifiable"
            )
            result = None
        else:
            result = answers[0]
        self._history[vault_id] = result
        return result

    def _plausible_heads(
        self, clients: list[JsonRpcClient], deadline: float
    ) -> list[tuple[JsonRpcClient, int]]:
        """Read every RPC's head once per run; refuse heads far from the median (REC-L1).

        The median is ONLY a plausibility filter. Every accepted RPC pages to the HIGHEST accepted head
        (ECC review, PR #22): a lagging or lying low-head RPC then misses later events and its history
        DISAGREES (-> unverifiable), instead of truncating an agreed history so an old copy looks current.
        """
        if self._heads is not None:
            return self._heads

        def head(c: JsonRpcClient) -> tuple[JsonRpcClient, int] | None:
            try:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise RpcError("history lookup deadline exceeded")
                return c, hex_to_int(c.call("eth_blockNumber", [], timeout=remaining))
            except RpcError as e:
                self.warnings.append(f"RPC {c.host}: event history unavailable ({e})")
                return None

        heads = [h for h in self._map(head, clients) if h is not None]
        if not heads:
            self._heads = []
            return self._heads
        ref = int(statistics.median_low(h for _, h in heads))
        plausible: list[tuple[JsonRpcClient, int]] = []
        for c, h in heads:
            if abs(h - ref) > HEAD_TOLERANCE:
                self.warnings.append(
                    f"RPC {c.host} reports an implausible latest block {h} (others: {ref}); "
                    "ignored for event history"
                )
            else:
                plausible.append((c, h))
        to_block = max(h for _, h in plausible)
        self._heads = [(c, to_block) for c, _ in plausible]
        return self._heads

    def _logs(
        self, c: JsonRpcClient, vault_id: bytes, latest: int, deadline: float
    ) -> list[tuple[int, bytes]]:
        start = self.deploy_block
        chunk = self.log_chunk
        if -(-(latest - start + 1) // chunk) > self.max_log_pages:
            # Fail fast before any eth_getLogs: the range cannot fit the page budget (hostile head).
            raise RpcError(f"history range of {latest - start + 1} blocks exceeds the page budget")
        requests = 0
        out: set[tuple[int, bytes]] = set()
        topics = [[_hex(abi.TOPIC_VAULT_CREATED), _hex(abi.TOPIC_VAULT_UPDATED)], _hex(vault_id)]
        while start <= latest:
            if time.monotonic() > deadline:
                raise RpcError("history lookup deadline exceeded")
            requests += 1
            if requests > self.max_log_pages:
                raise RpcError("too many log pages")
            end = min(latest, start + chunk - 1)
            try:
                logs = c.call(
                    "eth_getLogs",
                    [
                        {
                            "address": self.address,
                            "fromBlock": hex(start),
                            "toBlock": hex(end),
                            "topics": topics,
                        }
                    ],
                    timeout=max(0.001, deadline - time.monotonic()),
                )
            except RpcError as e:
                if is_range_error(e) and chunk > MIN_LOG_CHUNK:
                    chunk = max(MIN_LOG_CHUNK, chunk // 2)  # adapt to this RPC's limit and retry
                    # Fail fast: if even every remaining page at this size cannot fit the budget, this RPC
                    # cannot deliver the history; don't stall recovery paging it for minutes.
                    remaining_pages = -(-(latest - start + 1) // chunk)
                    budget = min(self.max_log_pages - requests, MAX_ADAPTED_PAGES)
                    if remaining_pages > budget:
                        raise RpcError(
                            f"block-range limit too small for {latest - start + 1} blocks"
                        ) from None
                    continue
                raise
            if not isinstance(logs, list):
                raise RpcError("malformed logs")
            for log in logs:
                out.add(self._parse_log(log, vault_id))
            start = end + 1
        return sorted(out)

    def _parse_log(self, log: Any, vault_id: bytes) -> tuple[int, bytes]:
        if not isinstance(log, dict):
            raise abi.AbiError("malformed log")
        if str(log.get("address", "")).lower() != self.address:
            raise abi.AbiError("log from wrong address")
        topics = log.get("topics")
        if not isinstance(topics, list) or len(topics) < 2:
            raise abi.AbiError("malformed topics")
        t0 = hex_to_bytes(topics[0], max_len=32)
        if t0 not in (abi.TOPIC_VAULT_CREATED, abi.TOPIC_VAULT_UPDATED):
            raise abi.AbiError("unexpected event")
        if hex_to_bytes(topics[1], max_len=32) != vault_id:
            raise abi.AbiError("log for another vault")
        return abi.decode_log_hash(hex_to_bytes(log.get("data"), max_len=64))


def classify(blob: bytes, hashes: list[tuple[int, bytes]] | None) -> Freshness:
    """Compare a mirrored blob against on-chain event hashes."""
    if hashes is None:
        return Freshness.UNVERIFIABLE
    if not hashes:
        return Freshness.UNMATCHED
    digest = keccak256(blob)
    latest = max(hashes)[1]
    if digest == latest:
        return Freshness.VERIFIED
    if any(digest == hsh for _, hsh in hashes):
        return Freshness.OUTDATED
    return Freshness.UNMATCHED

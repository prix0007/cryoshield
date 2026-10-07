"""VaultRegistry reads over several untrusted public RPCs.

Trust model: an RPC can lie by withholding, by adding junk, or by serving an OLDER genuine blob (which
still decrypts). We query every usable RPC and take the union of vault IDs; AES-GCM and the vaultId
binding reject forgeries and clones. Against rollback (audit REC-M1, change harden-recovery-network-trust):
a copy is "current" only with a quorum of distinct RPCs returning it and no disagreement, or when it
matches the latest event hash that several RPCs agree on. Self-reported versions are never trusted.

Registry versions (OpenSpec changes harden-gas-sponsorship and recover-registry-versions): ``Registries``
reads every VaultRegistry deployment on one chain, newest version first, and returns one candidate list.
They share one set of RPC clients, one quorum and one history deadline; each keeps its own resolve and
fetch budgets. v2-ABI locator lists have no cap, so they are paged (oldest pages first, plus the newest
pages when a list is longer than the page budget) and blobs are read with ``getVaults`` in batches.
"""

from __future__ import annotations

import statistics
import time
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Literal
from urllib.parse import urlparse

from . import abi
from .candidates import Candidate, Freshness
from .config import BUILT_IN, RegistrySpec
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
# Time budgets (ECC reviews of PR #40). Every budget belongs to ONE registry (v2 and v1 never share a
# clock, so one cannot starve the other) and starts when that registry's step starts:
# - resolve (resolveLocator/locatorLength): RESOLVE_DEADLINE per registry, and each (RPC, locator) at
#   most LOCATOR_BUDGET of it;
# - fetch (getVault/getVaults): STATE_DEADLINE per registry, and each RPC at most RPC_FETCH_BUDGET of it.
# RPCs run in parallel, so one slow or hung RPC costs at most its own cap, never the honest RPCs' time.
STATE_DEADLINE = 60.0
RPC_FETCH_BUDGET = 20.0
RESOLVE_DEADLINE = 30.0
LOCATOR_BUDGET = 10.0
# getVaults response cap: 32 blobs of 1 KB is ~38 KB of ABI data, ~76 KB as JSON hex (PR #40).
GET_VAULTS_MAX_RESPONSE = 128 * 1024
# Consecutive failed getVaults calls (other than "too large") after which one RPC is no longer asked.
MAX_BATCH_FAILURES = 6
# v2 paging budget per (RPC, locator): at most this many resolveLocator pages of 256 ids. Over budget,
# the oldest pages are read (stuffing happens after a locator is public, so a vault's own entry is
# normally early) plus the newest TAIL_PAGES (a locator made public elsewhere, e.g. on v1 or another
# chain, can be pre-stuffed, which pushes the vault's entry to the end).
MAX_LOCATOR_PAGES = 32
TAIL_PAGES = 4
# Candidate ids per locator that are read at most (the whole page budget). Ids are ranked by how many
# RPCs reported them, then by distance from either END of their locator's list (the oldest entries and
# the newest pre-stuffed ones come first), so junk in the middle is read last.
MAX_IDS_PER_LOCATOR = MAX_LOCATOR_PAGES * abi.V2_PAGE_SIZE
_DEADLINE_MSG = "state lookup deadline exceeded"


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
    if "beyond" in text and "head" in text:
        return False  # "block range extends beyond current head block": not a size limit (live, op-geth)
    return e.code in (-32600, -32602, -32000, -32001) and any(w in text for w in _RANGE_WORDS)


class DeadlineExceeded(RpcError):
    """A read was not sent because its time budget is spent (never retried)."""


def _hex(b: bytes) -> str:
    return "0x" + b.hex()


class Session:
    """What every registry read in one run shares: the RPC clients (probed once), the warnings, the
    state and history deadlines and the cached heads. Duplicate URLs count once (REC-M1)."""

    def __init__(self, urls: Sequence[str], chain_id: int, client_factory: ClientFactory = JsonRpcClient):
        self.chain_id = chain_id
        self.warnings: list[str] = []
        self.clients = [client_factory(u) for u in distinct_urls(urls)]
        self.usable: list[JsonRpcClient] | None = None
        self.history_deadline: float | None = None
        self.heads: list[tuple[JsonRpcClient, int]] | None = None


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
        kind: Literal[1, 2] = 1,
        label: str = "",
        session: Session | None = None,
        version: int | None = None,
        trusted: bool = True,
        builtin: bool = True,
    ) -> None:
        if kind not in (1, 2):
            raise ValueError("registry kind must be 1 or 2")
        self.version = kind if version is None else version  # the deployment's version (v3 may use kind 2)
        # A supplied registry that differs from every built-in one (recover-registry-versions D10).
        self.trusted = trusted
        self.builtin = builtin
        self.address = address.lower()
        self.chain_id = chain_id
        self.deploy_block = deploy_block
        self.log_chunk = log_chunk
        self.max_log_pages = max_log_pages
        self.kind = kind
        self.label = label  # shown in a candidate's origin, e.g. "registry v2"
        self.session = session if session is not None else Session(urls, chain_id, client_factory)
        self._history: dict[bytes, list[tuple[int, bytes]] | None] = {}
        # This registry's own resolve and fetch deadlines, set before any worker thread starts.
        self._resolve_deadline: float | None = None
        self._fetch_deadline: float | None = None

    @property
    def warnings(self) -> list[str]:
        return self.session.warnings

    @property
    def provenance(self) -> str:
        """Where a copy came from, for --list and the chooser (final security review, N3)."""
        v = self.version
        return (
            f"built-in registry v{v}"
            if self.builtin
            else f"SUPPLIED registry v{v} {self.address} (not built in)"
        )

    @property
    def _all(self) -> list[JsonRpcClient]:
        return self.session.clients

    @property
    def quorum(self) -> int:
        """Distinct configured RPCs that must agree: min(2, distinct configured)."""
        return min(2, len(self._all))

    # ------------------------------------------------------------------ connection
    def usable(self) -> list[JsonRpcClient]:
        if self.session.usable is None:

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

            self.session.usable = [c for c in self._map(probe, self._all) if c is not None]
        return self.session.usable

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

    def _start_fetch(self) -> float:
        if self._fetch_deadline is None:
            self._fetch_deadline = time.monotonic() + STATE_DEADLINE
        return self._fetch_deadline

    def _start_resolve(self) -> float:
        if self._resolve_deadline is None:
            self._resolve_deadline = time.monotonic() + RESOLVE_DEADLINE
        return self._resolve_deadline

    def _eth_call(
        self, c: JsonRpcClient, data: bytes, deadline: float, *, max_bytes: int | None = None
    ) -> bytes:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise DeadlineExceeded(_DEADLINE_MSG)
        params = [{"to": self.address, "data": _hex(data)}, "latest"]
        if max_bytes is None:
            res = c.call("eth_call", params, timeout=remaining)
        else:
            res = c.call("eth_call", params, timeout=remaining, max_bytes=max_bytes)
        return hex_to_bytes(res, max_len=c.max_bytes if max_bytes is None else max_bytes)

    # ------------------------------------------------------------------ lookups
    def resolve(self, locators: Sequence[bytes]) -> list[bytes]:
        """Union of candidate vaultIds for all locators across all usable RPCs.

        Ranked: ids reported by more distinct RPCs first; then by distance from either end of the list
        they were read from (per locator, so a second locator is never pushed behind the first one's
        junk, and the newest tail-page entries rank with the oldest); then by RPC order. At most
        MAX_IDS_PER_LOCATOR ids per locator are kept, i.e. everything the page budget reads."""
        deadline = self._start_resolve()

        def one(c: JsonRpcClient) -> list[list[bytes]]:
            lists: list[list[bytes]] = []
            for loc in locators:
                out: list[bytes] = []
                if self.kind == 2:
                    self._resolve_paged(c, loc, out, deadline)
                else:
                    try:
                        raw = self._eth_call(c, abi.encode_call(abi.SEL_RESOLVE_LOCATOR, loc), deadline)
                        out.extend(abi.decode_bytes32_array(raw))
                    except (RpcError, abi.AbiError) as e:
                        self.warnings.append(f"RPC {c.host}: discarded resolveLocator answer ({e})")
                lists.append(out)
            return lists

        support: dict[bytes, int] = {}
        best: dict[bytes, tuple[int, int]] = {}  # id -> (distance from an end of its list, RPC index)
        for rpc_index, lists in enumerate(self._map(one, self.usable(), [])):
            seen: set[bytes] = set()
            for ids in lists:
                n = len(ids)
                for pos, vid in enumerate(ids):
                    if not any(vid):
                        continue
                    key = (min(pos, n - 1 - pos), rpc_index)
                    best[vid] = min(best.get(vid, key), key)
                    if vid not in seen:
                        seen.add(vid)
                        support[vid] = support.get(vid, 0) + 1
        ranked_ids = sorted(support, key=lambda v: (-support[v], best[v]))
        cap = MAX_IDS_PER_LOCATOR * max(1, len(locators))
        if len(ranked_ids) > cap:
            self.warnings.append(
                f"{len(ranked_ids)} candidate vaults were listed for your key (possibly spam); only the "
                f"{cap} most widely reported were read. If your vault is not found, recover with --vault-id."
            )
        return ranked_ids[:cap]

    def _page_starts(self, length: int) -> tuple[list[int], bool]:
        """Page start offsets for a v2 list of ``length`` entries, and whether it was truncated."""
        page = abi.V2_PAGE_SIZE
        pages = -(-length // page)
        if pages <= MAX_LOCATOR_PAGES:
            return [i * page for i in range(pages)], False
        tail = min(TAIL_PAGES, MAX_LOCATOR_PAGES - 1)
        head = [i * page for i in range(MAX_LOCATOR_PAGES - tail)]
        first_tail = max(head[-1] + page, length - tail * page)
        return head + [first_tail + i * page for i in range(tail)], True

    def _resolve_paged(self, c: JsonRpcClient, loc: bytes, out: list[bytes], deadline: float) -> None:
        """v2: locatorLength, then bounded resolveLocator pages, within ``deadline`` and at most
        LOCATOR_BUDGET seconds for this (RPC, locator). Ids from complete pages are kept even if a later
        page fails or time runs out. A page longer than the page size is a lie and is discarded; a page
        longer than expected (the list grew since locatorLength) is truncated to what was expected."""
        page = abi.V2_PAGE_SIZE
        deadline = min(deadline, time.monotonic() + LOCATOR_BUDGET)
        try:
            length = abi.decode_uint256(
                self._eth_call(c, abi.encode_call(abi.SEL_LOCATOR_LENGTH, loc), deadline)
            )
            length = min(length, 2**64)  # no real list is longer; keeps every page start in uint256
            starts, truncated = self._page_starts(length)
            if truncated:
                self.warnings.append(
                    f"RPC {c.host}: a key's lookup list holds {length} entries (possibly spam); only part of "
                    f"it was read (the oldest {MAX_LOCATOR_PAGES - TAIL_PAGES} and newest {TAIL_PAGES} pages). "
                    "If your vault is not found, recover with --vault-id."
                )
            for start in starts:
                expect = min(page, length - start)
                ids = abi.decode_bytes32_array(
                    self._eth_call(c, abi.encode_resolve_page(loc, start, page), deadline), max_entries=page
                )
                ids = ids[:expect]  # appended after locatorLength: read next run, not now
                out.extend(ids)
                if len(ids) < expect:
                    break  # the list ends earlier than the claimed length: nothing more to read
        except (RpcError, abi.AbiError, ValueError) as e:
            self.warnings.append(f"RPC {c.host}: discarded resolveLocator answer ({e})")

    def _fetch_v1(
        self, c: JsonRpcClient, vault_ids: Sequence[bytes], deadline: float
    ) -> list[tuple[bytes, bytes, int]]:
        out: list[tuple[bytes, bytes, int]] = []
        for vid in vault_ids:
            try:
                raw = self._eth_call(c, abi.encode_call(abi.SEL_GET_VAULT, vid), deadline)
                _owner, blob, version = abi.decode_vault(raw)
            except (RpcError, abi.AbiError) as e:
                self.warnings.append(f"RPC {c.host}: discarded getVault answer ({e})")
                if isinstance(e, DeadlineExceeded):
                    break
                continue
            out.append((vid, blob, version))
        return out

    def _fetch_v2(
        self, c: JsonRpcClient, vault_ids: Sequence[bytes], deadline: float
    ) -> list[tuple[bytes, bytes, int]]:
        """getVaults in batches of at most 32. A failed batch (too large, transient error, malformed
        answer) is halved and retried. Bounded per RPC: MAX_BATCH_FAILURES consecutive failures (a
        too-large SINGLE id counts) and at most 3 calls per 32 ids, besides ``deadline``."""
        n = abi.V2_MAX_IDS_PER_CALL
        pending = [list(vault_ids[i : i + n]) for i in range(0, len(vault_ids), n)]
        max_calls = 3 * len(pending) + MAX_BATCH_FAILURES
        out: list[tuple[bytes, bytes, int]] = []
        failures = calls = 0
        while pending:
            if calls >= max_calls or failures > MAX_BATCH_FAILURES:
                self.warnings.append(f"RPC {c.host}: getVaults keeps failing; stopped asking it")
                break
            batch = pending.pop(0)
            calls += 1
            try:
                raw = self._eth_call(
                    c, abi.encode_get_vaults(batch), deadline, max_bytes=GET_VAULTS_MAX_RESPONSE
                )
                vaults = abi.decode_vaults(raw, len(batch))
            except DeadlineExceeded as e:
                self.warnings.append(f"RPC {c.host}: discarded getVaults answer ({e})")
                break
            except (RpcError, abi.AbiError) as e:
                too_large = isinstance(e, RpcError) and e.too_large
                failures += 0 if too_large and len(batch) > 1 else 1
                if len(batch) > 1:
                    half = len(batch) // 2
                    pending[:0] = [batch[:half], batch[half:]]
                    continue
                self.warnings.append(f"RPC {c.host}: discarded getVaults answer ({e})")
                continue
            failures = 0
            out.extend(
                (vid, blob, version) for vid, (_owner, blob, version) in zip(batch, vaults, strict=True)
            )
        return out

    def fetch(self, vault_ids: Sequence[bytes]) -> list[Candidate]:
        """Read each id from every usable RPC (v1 getVault, v2 getVaults). Each distinct (vaultId, blob)
        becomes ONE candidate whose ``support`` is the number of distinct RPCs that returned it."""
        ids = list(dict.fromkeys(vault_ids))
        read = self._fetch_v2 if self.kind == 2 else self._fetch_v1
        deadline = self._start_fetch()  # before the worker threads: one deadline, no race

        def one(c: JsonRpcClient) -> list[tuple[str, bytes, bytes, int]]:
            endpoint = normalize_url(getattr(c, "url", c.host))
            own = min(deadline, time.monotonic() + RPC_FETCH_BUDGET)  # one RPC never spends it all
            return [(endpoint, vid, blob, version) for vid, blob, version in read(c, ids, own) if blob]

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
        prefix = f"{self.label}: " if self.label else ""
        result = [
            Candidate(
                blob,
                "chain",
                prefix + ", ".join(hs),
                vid,
                versions[(vid, blob)],
                Freshness.UNVERIFIABLE,
                support=len(hs),
                registry=self.provenance,
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
        if self.session.history_deadline is None:
            self.session.history_deadline = time.monotonic() + HISTORY_DEADLINE
        deadline = self.session.history_deadline
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

        The median is ONLY a plausibility filter. Each accepted RPC pages to its OWN head: a lagging or
        lying low-head RPC then only shortens its own history, which DISAGREES with the others
        (-> unverifiable); it can never shorten an *agreed* history (ECC review, PR #22). Paging everyone
        to a common higher head is impossible anyway: op-geth/publicnode reject toBlock beyond their own
        head (security review M1, verified live 2026-10-04).
        """
        if self.session.heads is not None:
            return self.session.heads

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
            self.session.heads = []
            return self.session.heads
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
        self.session.heads = plausible
        return self.session.heads

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


class Registries:
    """Every VaultRegistry deployment on one chain, newest version first, read as one (vault-registry
    spec "Registry versions coexist"; recover-registry-versions D1-D3). A chain may have any subset:
    OP Mainnet has only v2, a legacy chain only v1, and a future chain v3 next to v2 and v1.

    Cross-registry rollback (harden-gas-sponsorship D9, generalised by recover-registry-versions D2): v1
    accepts client-chosen ids, so anyone can register a newer registry's vault id there with an OLDER
    genuine blob, which still decrypts (the AAD binds the vaultId, not the registry); and a vault that moved
    to a newer registry leaves its old copy behind. So the NEWEST registry holding an id is authoritative.
    For an id whose oldest copy is in registry j, the registries newer than j are walked newest first,
    whether or not a copy was read from them (a failed or withheld read must not let a plant through):
    - history unverifiable: no copy may be called current; copies in still-newer registries (agreed empty)
      are UNMATCHED; the remaining copies are ``contested`` when they come from more than one registry, so
      the user chooses instead of ranking deciding;
    - history present: that registry is authoritative; older copies are classified against it (an old blob
      is OUTDATED, anything else UNMATCHED) and newer copies (agreed empty) are UNMATCHED;
    - history agreed empty: continue. If all are empty, newer copies are UNMATCHED (a copy without a
      history is a lie) and the oldest holder's own classification stands (legacy v1 vaults).
    For ``[v2, v1]`` this is exactly the PR #40 rule.

    Trust (D10, D11): untrusted (supplied, not built-in) registries are walked AFTER every trusted one,
    so they never outrank a built-in registry. Their copies are never CURRENT or VERIFIED and are always
    ``contested``, and an empty history of theirs counts as unverifiable, never "agreed empty" (a
    supplied deploy block can hide events), so it can never demote anyone's copy.
    """

    def __init__(self, registries: Sequence[Registry]) -> None:
        if not registries:
            raise ValueError("at least one registry is needed")
        ordered = sorted(registries, key=lambda r: (not r.trusted, -r.version))
        if len({(r.version, r.trusted) for r in ordered}) != len(ordered):
            raise ValueError("each registry version may appear once (per trust group)")
        if any(r.session is not ordered[0].session for r in ordered):
            raise ValueError("all registries must share one session")
        self.registries = ordered
        self._primary = ordered[0]
        # Ids reported only by v2-ABI (batched) lists: v1-ABI registries don't read them one by one.
        self._batched_only: set[bytes] = set()

    @classmethod
    def build(
        cls,
        urls: Sequence[str],
        chain_id: int,
        specs: Sequence[RegistrySpec],
        *,
        client_factory: ClientFactory = JsonRpcClient,
        log_chunk: int = DEFAULT_LOG_CHUNK,
    ) -> Registries:
        """One registry per spec (any order; sorted newest first), all on one session."""
        session = Session(urls, chain_id, client_factory)
        several = len(specs) > 1
        return cls(
            [
                Registry(
                    urls,
                    spec.address,
                    chain_id,
                    spec.deploy_block,
                    log_chunk=log_chunk,
                    kind=spec.kind,
                    label=f"registry {spec.label}" if several or not spec.trusted else "",
                    session=session,
                    version=spec.version,
                    trusted=spec.trusted,
                    builtin=spec.source == BUILT_IN,
                )
                for spec in specs
            ]
        )

    @property
    def warnings(self) -> list[str]:
        return self._primary.warnings

    @property
    def quorum(self) -> int:
        return self._primary.quorum

    def usable(self) -> list[JsonRpcClient]:
        return self._primary.usable()

    def resolve(self, locators: Sequence[bytes]) -> list[bytes]:
        ordered: list[bytes] = []
        batched: set[bytes] = set()
        plain: set[bytes] = set()
        for reg in self.registries:
            ids = reg.resolve(locators)
            ordered.extend(ids)
            (batched if reg.kind == 2 else plain).update(ids)
        self._batched_only.update(batched - plain)
        return list(dict.fromkeys(ordered))

    def fetch(self, vault_ids: Sequence[bytes]) -> list[Candidate]:
        """v2-ABI registries read every id (batched, cheap); v1-ABI registries read every id not found
        ONLY through v2-ABI lists (v1 lists hold at most 16 ids per locator; with --vault-id that is every
        id)."""
        per: list[list[Candidate]] = []
        for reg in self.registries:
            ids = list(vault_ids) if reg.kind == 2 else [i for i in vault_ids if i not in self._batched_only]
            per.append(reg.fetch(ids) if ids else [])
        self._cross_check(per)
        self._cap_untrusted(per)
        return [c for cands in per for c in cands]

    def _history(self, index: int, vault_id: bytes) -> list[tuple[int, bytes]] | None:
        """A registry's agreed history; for an untrusted registry "agreed empty" is unverifiable (D11)."""
        reg = self.registries[index]
        history = reg.event_hashes(vault_id)
        return None if not reg.trusted and history == [] else history

    def _cap_untrusted(self, per: list[list[Candidate]]) -> None:
        """Copies from an untrusted registry are never current, and ranking never prefers them (D10)."""
        for reg, cands in zip(self.registries, per, strict=True):
            if reg.trusted or not cands:
                continue
            for c in cands:
                if c.freshness in (Freshness.CURRENT, Freshness.VERIFIED):
                    c.freshness = Freshness.UNVERIFIABLE
                c.contested = True
                c.untrusted = f"registry v{reg.version} {reg.address}"
            self.warnings.append(
                f"SECURITY: {len(cands)} copy(ies) came from registry v{reg.version} {reg.address}, which you "
                "supplied and is not built into this release. They are never called current, and a built-in "
                "registry's copy is always preferred."
            )

    def _cross_check(self, per: list[list[Candidate]]) -> None:
        by_id: dict[bytes, list[list[Candidate]]] = {}
        for index, cands in enumerate(per):
            for c in cands:
                if c.vault_id is not None:
                    by_id.setdefault(c.vault_id, [[] for _ in self.registries])[index].append(c)
        for vid, groups in by_id.items():
            held = [i for i, g in enumerate(groups) if g]
            oldest = held[-1]
            if oldest == 0:
                continue  # only the newest registry holds it: its own reconcile already decided
            for i in range(oldest):
                history = self._history(i, vid)
                if history is None:
                    self._unverifiable(vid, groups, i)
                    break
                if history:
                    self._authority(vid, groups, i, history)
                    break
            else:
                self._demote_newer(vid, groups, oldest)

    def _names(self, indexes: Sequence[int]) -> str:
        return ", ".join(self._name(i) for i in indexes)

    def _name(self, index: int) -> str:
        reg = self.registries[index]
        return f"v{reg.version}" if reg.trusted else f"v{reg.version} (supplied)"

    def _demote_newer(self, vid: bytes, groups: list[list[Candidate]], upto: int) -> None:
        """Copies in registries newer than ``upto`` whose history is agreed empty are lies."""
        lying = [i for i in range(upto) if groups[i]]
        for i in lying:
            for c in groups[i]:
                c.freshness = Freshness.UNMATCHED
        if lying:
            self.warnings.append(
                f"SECURITY: a server returned a registry {self._names(lying)} copy of vault 0x{vid.hex()} that "
                "has no on-chain history in that registry; it was ignored."
            )

    def _unverifiable(self, vid: bytes, groups: list[list[Candidate]], at: int) -> None:
        self._demote_newer(vid, groups, at)
        rest = [j for j in range(at, len(groups)) if groups[j]]
        for j in rest:
            for c in groups[j]:
                if c.freshness in (Freshness.CURRENT, Freshness.VERIFIED):
                    c.freshness = Freshness.UNVERIFIABLE
                c.contested = len(rest) > 1
        newer = self._name(at)
        where = (
            f"appears in several registry versions ({self._names(rest)})"
            if len(rest) > 1
            else f"was found in registry {self._names(rest)}"
        )
        self.warnings.append(
            f"SECURITY: vault 0x{vid.hex()} {where} and the history of the newer registry {newer} could not "
            "be confirmed, so no copy can be called current. Retry later or use --rpc with a server you "
            "trust."
        )

    def _authority(
        self, vid: bytes, groups: list[list[Candidate]], at: int, history: list[tuple[int, bytes]]
    ) -> None:
        self._demote_newer(vid, groups, at)
        older = [j for j in range(at + 1, len(groups)) if groups[j]]
        for j in older:
            for c in groups[j]:
                c.freshness = classify(c.blob, history)  # VERIFIED only if it IS the latest blob
        stale = [j for j in older if any(c.freshness is not Freshness.VERIFIED for c in groups[j])]
        if stale:
            auth = self._name(at)
            self.warnings.append(
                f"SECURITY: a copy of vault 0x{vid.hex()} in the older registry {self._names(stale)} uses the "
                f"ID of a registry {auth} vault and is not its current version (it may be an older copy left "
                "behind, or registered by someone else)."
            )

    def event_hashes(self, vault_id: bytes) -> list[tuple[int, bytes]] | None:
        """The agreed history of ``vault_id`` from the newest registry that has one. Unverifiable newer
        history makes the answer unverifiable (an older registry's history could be a plant)."""
        history: list[tuple[int, bytes]] | None = []
        for index, reg in enumerate(self.registries):
            history = self._history(index, vault_id)
            if history and not reg.trusted:
                return None  # only a supplied registry vouches for it: never a basis for VERIFIED (D10)
            if history is None or history:
                return history
        return history


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

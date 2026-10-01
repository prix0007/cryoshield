"""VaultRegistry reads over several untrusted public RPCs.

Trust model: an RPC can lie by withholding or by adding junk. We query every usable RPC, take the
union of what they return, and let AES-GCM decide. Wrong-chain endpoints are dropped.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from . import abi
from .candidates import Candidate, Freshness
from .keccak import keccak256
from .rpc import JsonRpcClient, RpcError, hex_to_bytes, hex_to_int

ClientFactory = Callable[[str], JsonRpcClient]


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
        log_chunk: int = 50_000,
        max_log_pages: int = 200,
    ) -> None:
        self.address = address.lower()
        self.chain_id = chain_id
        self.deploy_block = deploy_block
        self.log_chunk = log_chunk
        self.max_log_pages = max_log_pages
        self.warnings: list[str] = []
        self._all = [client_factory(u) for u in urls]
        self._usable: list[JsonRpcClient] | None = None
        self._history: dict[bytes, list[tuple[int, bytes]] | None] = {}

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
                    self.warnings.append(f"RPC {c.host} is on chain {got}, expected {self.chain_id}; ignored")
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
        """getVault for each id from every usable RPC; distinct blobs become candidates."""

        def one(c: JsonRpcClient) -> list[Candidate]:
            out: list[Candidate] = []
            for vid in vault_ids:
                try:
                    raw = self._eth_call(c, abi.encode_call(abi.SEL_GET_VAULT, vid))
                    _owner, blob, version = abi.decode_vault(raw)
                except (RpcError, abi.AbiError) as e:
                    self.warnings.append(f"RPC {c.host}: discarded getVault answer ({e})")
                    continue
                if blob:
                    out.append(Candidate(blob, "chain", c.host, vid, version, Freshness.CURRENT))
            return out

        result: list[Candidate] = []
        seen: set[tuple[bytes, bytes]] = set()
        for cands in self._map(one, self.usable(), []):
            for cand in cands:
                key = (cand.vault_id or b"", cand.blob)
                if key not in seen:
                    seen.add(key)
                    result.append(cand)
        self._reconcile(result)
        return result

    def _reconcile(self, cands: list[Candidate]) -> None:
        """RPCs that disagree about one vault's current blob: trust only the on-chain event record.

        A lagging or lying RPC can serve an older, genuine blob that still decrypts. When copies differ,
        each one is compared with the LATEST VaultCreated/VaultUpdated hash (agreed by several RPCs);
        non-matching copies are demoted, and the user is warned either way.
        """
        groups: dict[bytes, list[Candidate]] = {}
        for c in cands:
            if c.vault_id is not None:
                groups.setdefault(c.vault_id, []).append(c)
        for vid, group in groups.items():
            if len({c.blob for c in group}) < 2:
                continue
            hashes = self.event_hashes(vid)
            for c in group:
                fresh = classify(c.blob, hashes)
                c.freshness = Freshness.CURRENT if fresh is Freshness.VERIFIED else fresh
            if hashes:
                self.warnings.append(
                    f"SECURITY: blockchain servers disagree about vault 0x{vid.hex()} "
                    f"({len(group)} different copies). Using the copy that matches the latest on-chain "
                    "record; another server may be stale or lying."
                )
            else:
                self.warnings.append(
                    f"SECURITY: blockchain servers disagree about vault 0x{vid.hex()} "
                    f"({len(group)} different copies) and its on-chain history could not be confirmed. "
                    "The copy shown may not be the latest; retry later or use --rpc with a server you trust."
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
        clients = self.usable()

        def one(c: JsonRpcClient) -> list[tuple[int, bytes]] | None:
            try:
                return self._logs(c, vault_id)
            except (RpcError, abi.AbiError) as e:
                self.warnings.append(f"RPC {c.host}: event history unavailable ({e})")
                return None

        answers = [a for a in self._map(one, clients) if a is not None]
        # Count CONFIGURED RPCs, not merely reachable ones: if only 1 of 3 answers, that single answer
        # is unconfirmed (the others may be down because someone wants exactly that).
        need = min(2, len(self._all))
        result: list[tuple[int, bytes]] | None
        if not clients or len(answers) < need:
            if clients:
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

    def _logs(self, c: JsonRpcClient, vault_id: bytes) -> list[tuple[int, bytes]]:
        latest = hex_to_int(c.call("eth_blockNumber", []))
        start = self.deploy_block
        pages = 0
        out: list[tuple[int, bytes]] = []
        topics = [[_hex(abi.TOPIC_VAULT_CREATED), _hex(abi.TOPIC_VAULT_UPDATED)], _hex(vault_id)]
        while start <= latest:
            pages += 1
            if pages > self.max_log_pages:
                raise RpcError("too many log pages")
            end = min(latest, start + self.log_chunk - 1)
            logs = c.call(
                "eth_getLogs",
                [{"address": self.address, "fromBlock": hex(start), "toBlock": hex(end), "topics": topics}],
            )
            if not isinstance(logs, list):
                raise RpcError("malformed logs")
            for log in logs:
                out.append(self._parse_log(log, vault_id))
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

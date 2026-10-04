"""The recovery flow: key → locators → candidates (chain, then Arweave) → the vault that opens."""

from __future__ import annotations

import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Protocol

from .arweave import Arweave, ArweaveTx
from .authenticator import Assertion, PrfSource
from .candidates import Candidate, Freshness, ranked
from .chain import Registry, classify
from .config import Config
from .derive import derive_locator
from .errors import ExitCode, RecoveryError, VaultError
from .format import MAX_BLOB, DecodedVault, decode_blob
from .secure import wipe
from .vault import UnlockKey, matching_entries, open_decoded

log = logging.getLogger(__name__)

VAULT_ID_FOR_FILE = (
    "--blob-file also needs --vault-id: a vault only decrypts under the vault ID it was registered "
    "under (printed when the vault was unlocked or saved, and shown in the web app)."
)

# Distinct RP IDs tried in --vault-id/--blob-file mode (each costs a tap).
MAX_RP_IDS = 3


class UI(Protocol):
    def info(self, msg: str) -> None: ...
    def warn(self, msg: str) -> None: ...
    def pause(self, msg: str) -> None: ...
    def choose(self, prompt: str, options: list[str]) -> int: ...


@dataclass
class Result:
    secret: bytearray
    candidate: Candidate
    ignored: int
    warnings: list[str] = field(default_factory=list)


RegistryFactory = Callable[[Config], Registry]
ArweaveFactory = Callable[[Config], Arweave]


def _default_registry(cfg: Config) -> Registry:
    from functools import partial

    from .rpc import JsonRpcClient

    return Registry(
        cfg.rpcs,
        cfg.registry,
        cfg.chain_id,
        cfg.deploy_block,
        client_factory=partial(JsonRpcClient, timeout=cfg.timeout),
    )


def _default_arweave(cfg: Config) -> Arweave:
    return Arweave(cfg.arweave_graphql, cfg.arweave_gateways, timeout=max(cfg.timeout, 15.0))


class Recovery:
    def __init__(
        self,
        cfg: Config,
        prf: PrfSource,
        ui: UI,
        *,
        registry_factory: RegistryFactory = _default_registry,
        arweave_factory: ArweaveFactory = _default_arweave,
    ) -> None:
        self.cfg = cfg
        self.prf = prf
        self.ui = ui
        self._registry_factory = registry_factory
        self._arweave_factory = arweave_factory
        self._registry: Registry | None = None
        self._arweave: Arweave | None = None
        self.assertions: list[Assertion] = []
        self._notes: list[str] = []

    # ------------------------------------------------------------------ sources
    @property
    def registry(self) -> Registry | None:
        if self._registry is None and self.cfg.chain_configured:
            self._registry = self._registry_factory(self.cfg)
        return self._registry

    @property
    def arweave(self) -> Arweave | None:
        if self._arweave is None and self.cfg.arweave_configured:
            self._arweave = self._arweave_factory(self.cfg)
        return self._arweave

    def warnings(self) -> list[str]:
        out: list[str] = list(self._notes)
        for src in (self._registry, self._arweave):
            if src is not None:
                out.extend(src.warnings)
        return out

    def _chain_usable(self) -> bool:
        reg = self.registry
        return reg is not None and bool(reg.usable())

    def _hashes(self, vault_id: bytes | None) -> list[tuple[int, bytes]] | None:
        if vault_id is None or not self._chain_usable():
            return None
        assert self.registry is not None
        return self.registry.event_hashes(vault_id)  # cached by the registry

    def _chain_by_locators(self, locators: Sequence[bytes]) -> list[Candidate]:
        reg = self.registry
        if reg is None:
            return []
        self.ui.info(f"Looking up your vault on {len(self.cfg.rpcs)} public blockchain server(s)…")
        ids = reg.resolve(locators)
        cands = reg.fetch(ids) if ids else []
        log.debug(
            "chain: %d usable RPC(s), %d vault id(s), %d candidate blob(s)",
            len(reg.usable()),
            len(ids),
            len(cands),
        )
        return cands

    def _arweave_candidates(self, txs_fn: Callable[[Arweave], list[ArweaveTx]]) -> list[Candidate]:
        ar = self.arweave
        if ar is None:
            return []
        self.ui.info("Searching the Arweave permanent archive…")
        # One record per (GraphQL server, tx) (REC-M2). Identical (vaultId, blob) from several servers
        # merge into one candidate whose support counts the distinct servers.
        merged: dict[tuple[bytes | None, bytes], tuple[ArweaveTx, set[str]]] = {}
        for tx in txs_fn(ar):
            blob = ar.fetch(tx)
            if blob is None:
                continue
            key = (tx.vault_id, blob)
            if key in merged:
                merged[key][1].add(tx.server)
            else:
                merged[key] = (tx, {tx.server})
        return [
            Candidate(
                blob,
                "arweave",
                tx.id,
                vid,
                tx.version,
                classify(blob, self._hashes(vid)),
                tx.height,
                support=len(servers),
            )
            for (vid, blob), (tx, servers) in merged.items()
        ]

    def _arweave_by_locators(self, locators: Sequence[bytes]) -> list[Candidate]:
        def find(ar: Arweave) -> list[ArweaveTx]:
            txs: list[ArweaveTx] = []
            seen: set[str] = set()
            for loc in locators:
                for t in ar.find_by_locator(loc):
                    if t.id not in seen:
                        seen.add(t.id)
                        txs.append(t)
            return txs

        return self._arweave_candidates(find)

    def _by_vault_id(self, vault_id: bytes) -> list[Candidate]:
        cands: list[Candidate] = []
        if self.registry is not None:
            cands.extend(self.registry.fetch([vault_id]))
        cands.extend(self._arweave_candidates(lambda ar: ar.find_by_vault_id(vault_id)))
        return cands

    def _from_file(self) -> list[Candidate]:
        path = self.cfg.blob_file
        assert path is not None
        limit = 2 * MAX_BLOB + 16  # room for a hex dump with 0x prefix and whitespace
        try:
            with open(path, "rb") as f:
                data = f.read(limit + 1)
        except OSError as e:
            raise RecoveryError(ExitCode.USAGE, f"Cannot read {path}: {e.strerror}.") from None
        stripped = data.strip()
        body = stripped[2:] if stripped.startswith(b"0x") else stripped
        if body and len(body) % 2 == 0 and all(c in b"0123456789abcdefABCDEF" for c in body):
            data = bytes.fromhex(body.decode())  # a hex dump, as shown by block explorers
        if len(data) > MAX_BLOB:
            raise RecoveryError(
                ExitCode.NO_MATCHING_VAULT, f"{path} is larger than {MAX_BLOB} bytes; not a vault."
            )
        if self.cfg.vault_id is None:
            raise RecoveryError(ExitCode.USAGE, VAULT_ID_FOR_FILE)
        return [Candidate(data, "file", str(path), vault_id=self.cfg.vault_id, freshness=Freshness.LOCAL)]

    # ------------------------------------------------------------------ key
    def _tap(self, rp_id: str, allow: Sequence[bytes] | None) -> list[Assertion]:
        got = self.prf.get(rp_id, allow)
        self.assertions.extend(got)
        return got

    def _keys(self) -> list[UnlockKey]:
        return [UnlockKey(a.prf, a.cred_id) for a in self.assertions]

    # ------------------------------------------------------------------ selection
    def _select(self, cands: list[Candidate]) -> tuple[Result | None, list[tuple[Candidate, DecodedVault]]]:
        ignored = 0
        pending: list[tuple[Candidate, DecodedVault]] = []
        for cand in ranked(cands):
            if cand.vault_id is None:
                # vault-format-v1 §4.1: a blob only opens under the vaultId it was found under. A copy
                # without one (e.g. an untagged Arweave tx) cannot be authenticated and is ignored.
                ignored += 1
                continue
            try:
                d = decode_blob(cand.blob)
            except VaultError:
                ignored += 1  # malformed: never reaches the Shamir path
                continue
            try:
                secret = open_decoded(d, self._keys(), cand.vault_id)
            except VaultError as e:
                if e.code == "INSUFFICIENT_SHARES":
                    pending.append((cand, d))
                else:
                    ignored += 1
                continue
            log.debug("selected candidate from %s (%s), ignored %d", cand.source, cand.origin, ignored)
            picked = self._resolve_ties(cand, cands)
            if picked is not cand:
                wipe(secret)
                assert picked.vault_id is not None
                secret = open_decoded(decode_blob(picked.blob), self._keys(), picked.vault_id)
                cand = picked
            return Result(secret, cand, ignored), pending
        return None, pending

    def _decrypting_rivals(self, chosen: Candidate, cands: list[Candidate]) -> list[Candidate]:
        """Other DIFFERENT blobs for the same vault that also decrypt with the keys held."""
        rivals: list[Candidate] = []
        for other in ranked(cands):
            if other is chosen or other.vault_id != chosen.vault_id or other.blob == chosen.blob:
                continue
            try:
                assert other.vault_id is not None  # equals chosen.vault_id, which opened
                wipe(open_decoded(decode_blob(other.blob), self._keys(), other.vault_id))
            except VaultError:
                continue
            rivals.append(other)
        return rivals

    def _resolve_ties(self, chosen: Candidate, cands: list[Candidate]) -> Candidate:
        """Without a chain-verified copy, never let ranking silently decide between different decrypting
        copies of equal standing (audit REC-M1): warn, and on an exact tie make the user choose."""
        if chosen.freshness in (Freshness.CURRENT, Freshness.VERIFIED):
            return chosen
        rivals = self._decrypting_rivals(chosen, cands)
        if not rivals:
            return chosen
        vid = (chosen.vault_id or b"").hex()
        tied = [r for r in rivals if r.rank == chosen.rank]
        if not tied:
            self._notes.append(
                f"Several different copies of vault 0x{vid} decrypt with this key and the blockchain could "
                "not verify which one is current. Showing the copy most sources returned; an older copy may "
                "be shown. Retry when the blockchain is reachable, or use --rpc with a server you trust."
            )
            return chosen
        options = [chosen, *tied]
        labels = [
            f"Copy {i + 1}: from {c.source} ({c.origin}); returned by {c.support} source(s); "
            f"claims version {c.version if c.version is not None else '?'} (unverified); "
            f"status: {c.freshness.value}"
            for i, c in enumerate(options)
        ]
        self.ui.warn(
            f"SECURITY: {len(options)} different copies of vault 0x{vid} decrypt with your key, and the "
            "servers disagree about which is current. One of them may be an OLDER version served by a "
            "stale or lying server. Choose the copy you expect, or cancel and retry with --rpc pointing at "
            "a server you trust."
        )
        index = self.ui.choose("Which copy should be opened?", labels)
        if not 0 <= index < len(options):
            raise RecoveryError(ExitCode.CANCELLED, "No copy chosen.")
        picked = options[index]
        self._notes.append(
            f"You chose copy {index + 1} of vault 0x{vid}; its freshness could not be verified on-chain."
        )
        return picked

    def _shamir(self, cand: Candidate, d: DecodedVault) -> Result:
        """Collect more enrolled keys, one tap at a time, until M distinct shares unwrap."""
        cred_ids = [e.cred_id for e in d.entries]
        assert cand.vault_id is not None
        vault_id = cand.vault_id

        def held() -> set[int]:
            out: set[int] = set()
            for k in self._keys():
                out.update(matching_entries(d, k, vault_id))
            return out

        have = held()
        for _ in range(2 * d.count):
            if len(have) >= d.threshold:
                break
            self.ui.pause(
                f"This vault needs {d.threshold} different enrolled keys; {len(have)} recognised so far. "
                "Remove the current key and insert another one."
            )
            new = self._tap(d.rp_id, cred_ids)
            before = len(have)
            have = held()
            if not new:
                self.ui.info("That key is not enrolled in this vault. Try a different key.")
            elif len(have) == before:
                self.ui.info("You already used that key. Please insert a different enrolled key.")
        try:
            return Result(open_decoded(d, self._keys(), vault_id), cand, 0)
        except VaultError as e:
            raise RecoveryError(
                ExitCode.NO_MATCHING_VAULT,
                f"Could not collect enough keys for this {d.threshold}-of-{d.count} vault ({e.code}).",
            ) from None

    def _finish(self, cands: list[Candidate]) -> Result | None:
        result, pending = self._select(cands)
        if result is None and pending:
            result = self._shamir(*pending[0])
        return result

    def _rp_id_order(self, pairs: list[tuple[Candidate, DecodedVault]]) -> list[str]:
        """Which RP IDs to try, safest first.

        A candidate's RP ID is attacker-influenced (anyone can tag an Arweave tx with a victim's vault
        ID), so the first decodable blob must not choose it. Order: the configured/baked RP ID, then RP
        IDs of on-chain copies, then the user's own file, then the rest in rank order. Capped, so junk
        cannot make the user tap endlessly.
        """
        order: list[str] = []
        rps = [d.rp_id for _, d in pairs]
        if self.cfg.rp_id in rps:
            order.append(self.cfg.rp_id)
        for source in ("chain", "file", "arweave"):
            for c, d in pairs:
                if c.source == source and d.rp_id not in order:
                    order.append(d.rp_id)
        return order[:MAX_RP_IDS]

    def _by_rp_ids(self, pairs: list[tuple[Candidate, DecodedVault]]) -> Result:
        tapped_any = False
        for rp_id in self._rp_id_order(pairs):
            group = [(c, d) for c, d in pairs if d.rp_id == rp_id]
            if rp_id != self.cfg.rp_id:
                where = {"chain": "on-chain", "file": "your file", "arweave": "an Arweave copy"}[
                    group[0][0].source
                ]
                self.ui.info(
                    f"The vault copy from {where} was created for the site '{rp_id}'; "
                    f"trying that instead of '{self.cfg.rp_id}'."
                )
            allow = list(dict.fromkeys(e.cred_id for _, d in group for e in d.entries))
            if not self._tap(rp_id, allow):
                self.ui.info(f"This key has no credential for '{rp_id}'.")
                continue
            tapped_any = True
            result = self._finish([c for c, _ in group])
            if result is not None:
                return result
        if not tapped_any:
            raise RecoveryError(
                ExitCode.NO_CREDENTIAL, "This key is not enrolled in that vault. Try another enrolled key."
            )
        raise RecoveryError(ExitCode.NO_MATCHING_VAULT, "The key did not unlock that vault.")

    # ------------------------------------------------------------------ main flow
    def run(self) -> Result:
        try:
            result = self._run()
            result.warnings = self.warnings()
            return result
        finally:
            for a in self.assertions:
                wipe(a.prf)

    def _run(self) -> Result:
        cfg = self.cfg
        if cfg.blob_file is not None or cfg.vault_id is not None:
            if cfg.blob_file is not None:
                cands = self._from_file()
            else:
                assert cfg.vault_id is not None  # narrowed by the enclosing condition
                cands = self._by_vault_id(cfg.vault_id)
            pairs: list[tuple[Candidate, DecodedVault]] = []
            for c in ranked(cands):
                try:
                    pairs.append((c, decode_blob(c.blob)))
                except VaultError:
                    continue
            if not pairs:
                where = "file" if cfg.blob_file is not None else "vault ID"
                msg = f"No CryoShield vault was found for that {where}."
                if cfg.blob_file is None and self.warnings():
                    msg += " Some servers could not be reached; check your connection or pass --rpc."
                raise RecoveryError(ExitCode.NO_MATCHING_VAULT, msg)
            return self._by_rp_ids(pairs)

        got = self._tap(cfg.rp_id, cfg.credential_ids or None)
        if not got:
            raise RecoveryError(
                ExitCode.NO_CREDENTIAL,
                f"This key has no discoverable CryoShield credential for '{cfg.rp_id}'.\n"
                "If your vault was created without one, recover with --vault-id <id>, "
                "--credential-id <id>, or --blob-file <saved vault file>. "
                "If you used a different site address, pass --rp-id.",
            )
        locators = [derive_locator(a.prf) for a in got]
        log.debug("derived %d locator(s)", len(locators))

        chain_cands = self._chain_by_locators(locators) if self.registry is not None else []
        result = self._finish(chain_cands) if chain_cands else None
        if result is None:
            ar_cands = self._arweave_by_locators(locators)
            result = self._finish(ar_cands) if ar_cands else None  # chain copies already failed
        if result is not None:
            return result

        reachable = self._chain_usable() or (self.arweave is not None and not self.arweave.warnings)
        if not reachable:
            raise RecoveryError(
                ExitCode.NETWORK_UNAVAILABLE,
                "Could not reach any blockchain or Arweave server. Check your internet connection, or pass "
                "--rpc <url> for a server you trust, or --blob-file for a saved copy of your vault.",
            )
        raise RecoveryError(
            ExitCode.NO_MATCHING_VAULT,
            "No vault unlocked with this key. Try another enrolled key, check --rp-id and --network, "
            "or recover with --vault-id if you know it.",
        )

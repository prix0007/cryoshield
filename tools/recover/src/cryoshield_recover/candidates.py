"""Vault candidates from any source, and how they are ranked."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Freshness(str, Enum):
    CURRENT = "current"  # read from on-chain state (getVault)
    VERIFIED = "verified"  # Arweave copy whose keccak256 equals the latest on-chain event hash
    OUTDATED = "outdated"  # Arweave copy matching an older on-chain event hash
    UNMATCHED = "unmatched"  # Arweave copy whose hash matches no on-chain event for its vault
    UNVERIFIABLE = "unverifiable"  # no chain available to compare against
    LOCAL = "local"  # a file supplied by the user


_RANK = {
    Freshness.CURRENT: 0,
    Freshness.VERIFIED: 1,
    Freshness.LOCAL: 2,
    Freshness.UNVERIFIABLE: 3,
    Freshness.OUTDATED: 4,
    Freshness.UNMATCHED: 5,
}


@dataclass
class Candidate:
    blob: bytes
    source: str  # "chain" | "arweave" | "file"
    origin: str  # RPC host, Arweave tx id, or file path (public info only)
    vault_id: bytes | None = None
    version: int | None = None
    freshness: Freshness = Freshness.UNVERIFIABLE
    height: int | None = None
    # Distinct sources (RPCs, or GraphQL servers) that returned exactly this (vaultId, blob).
    support: int = 1
    # Copies of this vault id disagree in a way the chain could not settle (v1 vs v2 with unconfirmed v2
    # history): ranking must not decide between them; the user chooses (harden-gas-sponsorship D9).
    contested: bool = False
    # Set when this copy came from a supplied registry that is not built in (recover-registry-versions
    # D10): "registry vN 0x…". Shown again next to the result and the --output/--save-blob messages.
    untrusted: str = ""
    # Where a chain copy came from, for --list and the chooser: "built-in registry v2", or
    # "SUPPLIED registry v3 0x… (not built in)". Empty for Arweave and file copies.
    registry: str = ""

    @property
    def rank(self) -> tuple[int, int, int, int]:
        """Freshness class, then MORE independent sources, then newer Arweave block height.

        A version reported by an RPC or an Arweave tag is attacker-writable and is NEVER used for
        ranking (audit REC-M1: one liar claimed version 2**32-1 to win)."""
        # A copy from a supplied, untrusted registry never ranks ahead of an equally fresh trusted copy,
        # however many servers returned it (PR #48 review): it is never "Copy 1" by default.
        return _RANK[self.freshness], 1 if self.untrusted else 0, -self.support, -(self.height or 0)


def dedupe(cands: list[Candidate]) -> list[Candidate]:
    """Keep the best-ranked copy of each distinct (vaultId, blob), preserving order otherwise.

    The key MUST include the vaultId: a byte-identical clone under another vaultId is a different
    candidate (it fails authentication), and merging the two could drop the genuine one (§4.1).
    """
    best: dict[tuple[bytes | None, bytes], Candidate] = {}
    order: list[tuple[bytes | None, bytes]] = []
    for c in cands:
        key = (c.vault_id, c.blob)
        if key not in best:
            best[key] = c
            order.append(key)
        elif c.rank < best[key].rank:
            best[key] = c
    return [best[k] for k in order]


def ranked(cands: list[Candidate]) -> list[Candidate]:
    return sorted(dedupe(cands), key=lambda c: c.rank)

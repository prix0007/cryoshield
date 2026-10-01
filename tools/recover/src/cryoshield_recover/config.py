"""Built-in defaults. Every value can be overridden from the command line; nothing here points to a
CryoShield-operated server.
"""

from __future__ import annotations

import base64
import binascii
import re
from dataclasses import dataclass, field
from pathlib import Path

PLACEHOLDER_ADDRESS = "0x0000000000000000000000000000000000000000"

# Production RP ID of the web app. Placeholder until the web-app change fixes the domain (design D8).
DEFAULT_RP_ID = "cryoshield.app"

ARWEAVE_GRAPHQL = ("https://arweave.net/graphql", "https://arweave-search.goldsky.com/graphql")
ARWEAVE_GATEWAYS = ("https://arweave.net", "https://ar-io.net")


@dataclass(frozen=True)
class NetworkPreset:
    name: str
    chain_id: int
    registry: str
    deploy_block: int
    rpcs: tuple[str, ...]


NETWORKS = {
    "arbitrum-one": NetworkPreset(
        name="arbitrum-one",
        chain_id=42161,
        # Filled in at release from contracts/deployments/42161.json (guarded by a release test).
        registry=PLACEHOLDER_ADDRESS,
        deploy_block=0,
        rpcs=(
            "https://arb1.arbitrum.io/rpc",
            "https://arbitrum-one-rpc.publicnode.com",
            "https://arbitrum.drpc.org",
        ),
    ),
    "arbitrum-sepolia": NetworkPreset(
        name="arbitrum-sepolia",
        chain_id=421614,
        registry=PLACEHOLDER_ADDRESS,
        deploy_block=0,
        rpcs=(
            "https://sepolia-rollup.arbitrum.io/rpc",
            "https://arbitrum-sepolia-rpc.publicnode.com",
            "https://arbitrum-sepolia.drpc.org",
        ),
    ),
}
DEFAULT_NETWORK = "arbitrum-one"

_ADDR = re.compile(r"^0x[0-9a-fA-F]{40}$")
_HEX32 = re.compile(r"^(0x)?[0-9a-fA-F]{64}$")


def is_placeholder(address: str) -> bool:
    return address.lower() == PLACEHOLDER_ADDRESS


def parse_address(s: str) -> str:
    if not _ADDR.match(s):
        raise ValueError(f"not a 20-byte hex address: {s}")
    return s.lower()


def parse_bytes32(s: str) -> bytes:
    if not _HEX32.match(s):
        raise ValueError("expected 32 bytes of hex (64 hex digits, optional 0x)")
    raw = bytes.fromhex(s[2:] if s.startswith("0x") else s)
    if not any(raw):
        raise ValueError("a vault ID cannot be all zero")
    return raw


def parse_credential_id(s: str) -> bytes:
    """Hex (optional 0x) or base64url, as browsers show credential IDs."""
    t = s.strip()
    if re.fullmatch(r"(0x)?([0-9a-fA-F]{2})+", t):
        raw = bytes.fromhex(t[2:] if t.startswith("0x") else t)
    else:
        try:
            raw = base64.urlsafe_b64decode(t + "=" * (-len(t) % 4))
        except (binascii.Error, ValueError):
            raise ValueError("credential ID must be hex or base64url") from None
    if not 1 <= len(raw) <= 128:
        raise ValueError("credential ID must be 1–128 bytes")
    return raw


@dataclass
class Config:
    rp_id: str = DEFAULT_RP_ID
    network: str = DEFAULT_NETWORK
    chain_id: int = NETWORKS[DEFAULT_NETWORK].chain_id
    registry: str = NETWORKS[DEFAULT_NETWORK].registry
    deploy_block: int = NETWORKS[DEFAULT_NETWORK].deploy_block
    rpcs: list[str] = field(default_factory=lambda: list(NETWORKS[DEFAULT_NETWORK].rpcs))
    arweave_graphql: list[str] = field(default_factory=lambda: list(ARWEAVE_GRAPHQL))
    arweave_gateways: list[str] = field(default_factory=lambda: list(ARWEAVE_GATEWAYS))
    use_chain: bool = True
    use_arweave: bool = True
    timeout: float = 10.0
    offline: bool = False
    vault_id: bytes | None = None
    credential_ids: list[bytes] = field(default_factory=list)
    blob_file: Path | None = None
    output: Path | None = None
    save_blob: Path | None = None
    verbose: bool = False
    rp_id_overridden: bool = False

    @property
    def chain_configured(self) -> bool:
        return self.use_chain and not self.offline and bool(self.rpcs) and not is_placeholder(self.registry)

    @property
    def arweave_configured(self) -> bool:
        return (
            self.use_arweave
            and not self.offline
            and bool(self.arweave_graphql)
            and bool(self.arweave_gateways)
        )

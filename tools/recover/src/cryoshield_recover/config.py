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

# Production RP ID of the web app (deployed at https://cryoshield.app).
DEFAULT_RP_ID = "cryoshield.app"

ARWEAVE_GRAPHQL = ("https://arweave.net/graphql", "https://arweave-search.goldsky.com/graphql")
ARWEAVE_GATEWAYS = ("https://arweave.net", "https://ar-io.net")


@dataclass(frozen=True)
class NetworkPreset:
    name: str
    chain_id: int
    registry: str  # VaultRegistry v1 (top-level address in the deployment record), or placeholder
    deploy_block: int
    rpcs: tuple[str, ...]
    # VaultRegistry v2 (contracts.vaultRegistryV2 in the deployment record; change
    # harden-gas-sponsorship), or placeholder until deployed on this chain.
    registry_v2: str = PLACEHOLDER_ADDRESS
    deploy_block_v2: int = 0


# Network presets (OpenSpec change target-op-sepolia, design D2). A chain is data, never code.
# Registry addresses (v1 and v2) and deploy blocks are GENERATED at release from contracts/deployments/<chainId>.json
# and embedded here; that file is never read at runtime (the binary must work outside the repo). A preset
# without a deployment record keeps PLACEHOLDER_ADDRESS, which disables chain mode with a clear message.
# Names and chain IDs must match config/chain-presets.json (parity test).
NETWORKS = {
    "anvil": NetworkPreset(
        name="anvil",
        chain_id=31337,
        # Local development chain; deterministic CREATE2 address from contracts/deployments/31337.json.
        registry="0xb43f58cf17e64b603ae5588a1dd17e96a0849e44",
        deploy_block=1,
        rpcs=("http://127.0.0.1:8545",),
        # contracts.vaultRegistryV2 in contracts/deployments/31337.json (same CREATE2 address as OP Sepolia).
        registry_v2="0xa622c92d3d5b54aea081cf410224a8a2ecb08cb7",
        deploy_block_v2=2,
    ),
    "op-sepolia": NetworkPreset(
        name="op-sepolia",
        chain_id=11155420,
        # From contracts/deployments/11155420.json (tx 0xb3608598…0759; source verified on Blockscout).
        registry="0xb43f58cf17e64b603ae5588a1dd17e96a0849e44",
        deploy_block=49568053,
        # contracts.vaultRegistryV2 in contracts/deployments/11155420.json (tx 0x34728ea3…3d02).
        registry_v2="0xa622c92d3d5b54aea081cf410224a8a2ecb08cb7",
        deploy_block_v2=49755277,
        # Verified to answer eth_chainId = 11155420 on 2026-10-02 (omniatech excluded: HTTP 521).
        rpcs=(
            "https://sepolia.optimism.io",
            "https://optimism-sepolia-rpc.publicnode.com",
            "https://optimism-sepolia.drpc.org",
        ),
    ),
    "op-mainnet": NetworkPreset(
        name="op-mainnet",
        chain_id=10,
        registry=PLACEHOLDER_ADDRESS,
        deploy_block=0,
        rpcs=(
            "https://mainnet.optimism.io",
            "https://optimism-rpc.publicnode.com",
            "https://optimism.drpc.org",
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
    "arbitrum-one": NetworkPreset(
        name="arbitrum-one",
        chain_id=42161,
        registry=PLACEHOLDER_ADDRESS,
        deploy_block=0,
        rpcs=(
            "https://arb1.arbitrum.io/rpc",
            "https://arbitrum-one-rpc.publicnode.com",
            "https://arbitrum.drpc.org",
        ),
    ),
}
# The single default network. Changes only through an OpenSpec change (deployment-targets spec).
DEFAULT_NETWORK = "op-sepolia"
# What --testnet means.
TESTNET = "op-sepolia"
# Network name for a non-preset --chain-id (requires --rpc; never carries a built-in registry).
CUSTOM_NETWORK = "custom"


def preset_for_chain_id(chain_id: int) -> NetworkPreset | None:
    return next((p for p in NETWORKS.values() if p.chain_id == chain_id), None)


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
    registry_v2: str = NETWORKS[DEFAULT_NETWORK].registry_v2
    deploy_block_v2: int = NETWORKS[DEFAULT_NETWORK].deploy_block_v2
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
    rpcs_user_supplied: bool = False

    @property
    def has_registry(self) -> bool:
        """At least one VaultRegistry version (v1 or v2) is known for this chain."""
        return not (is_placeholder(self.registry) and is_placeholder(self.registry_v2))

    @property
    def chain_configured(self) -> bool:
        return self.use_chain and not self.offline and bool(self.rpcs) and self.has_registry

    @property
    def arweave_configured(self) -> bool:
        return (
            self.use_arweave
            and not self.offline
            and bool(self.arweave_graphql)
            and bool(self.arweave_gateways)
        )

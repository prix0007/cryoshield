"""Built-in defaults. Every value can be overridden from the command line; nothing here points to a
CryoShield-operated server.
"""

from __future__ import annotations

import base64
import binascii
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

PLACEHOLDER_ADDRESS = "0x0000000000000000000000000000000000000000"

_ADDR = re.compile(r"^0x[0-9a-fA-F]{40}$")
_HEX32 = re.compile(r"^(0x)?[0-9a-fA-F]{64}$")


def is_placeholder(address: str) -> bool:
    return address.lower() == PLACEHOLDER_ADDRESS


def parse_address(s: str) -> str:
    if not _ADDR.match(s):
        shown = s if len(s) <= 60 else s[:60] + "…"
        raise ValueError(f"not a 20-byte hex address: {shown!r}")
    return s.lower()


# Production RP ID of the web app (deployed at https://cryoshield.app).
DEFAULT_RP_ID = "cryoshield.app"

ARWEAVE_GRAPHQL = ("https://arweave.net/graphql", "https://arweave-search.goldsky.com/graphql")
ARWEAVE_GATEWAYS = ("https://arweave.net", "https://ar-io.net")


AbiKind = Literal[1, 2]

# VaultRegistry read ABIs this release knows (OpenSpec change recover-registry-versions, D6). Kind 1 is
# v1's views (resolveLocator(bytes32), getVault); kind 2 is v2's (locatorLength, paged resolveLocator,
# getVaults). Both share the VaultCreated/VaultUpdated event layout.
KNOWN_ABI_KINDS: dict[int, AbiKind] = {1: 1, 2: 2}
# keccak256 of the exact bytes of contracts/abi/VaultRegistry.json and VaultRegistryV2.json (the records'
# `abiHash`). A newer version whose record carries one of these hashes has that ABI byte for byte.
ABI_HASHES: dict[str, AbiKind] = {
    "0x978e16a51813cacf2f723f72db77d1e10c186e489ccf4cca8ec8bb4517cd0a07": 1,
    "0xacb135ccf895846a59981b20545041660e21942c6108c000d9f1c46f552cb95c": 2,
}
# Each registry has its own time budgets (chain.py), so the count bounds the worst-case run time.
MAX_REGISTRIES = 8
MAX_VERSION = 999
MAX_BLOCK = 2**63
BUILT_IN = "built-in"
FLAG_SOURCE = "--registry"
REGISTRY_FORM = "--registry ADDRESS[@DEPLOY_BLOCK][:vN[:abi=vK]]"


class UnknownRegistryVersion(ValueError):
    """A registry version whose read ABI this release does not know (never guessed)."""

    def __init__(self, version: int, address: str = "") -> None:
        where = f" (address {address})" if address else ""
        super().__init__(
            f"This tool doesn't know registry v{version}{where}; update cryoshield-recover. If you know its "
            f"read functions match v2's, pass {address or 'ADDRESS'}@DEPLOY_BLOCK:v{version}:abi=v2."
        )
        self.version = version


def abi_kind_for(
    version: int, *, explicit: int | None = None, abi_hash: str | None = None, address: str = ""
) -> AbiKind:
    """The read ABI for a registry version (D6): v1 and v2 have their own; a newer version needs an
    explicit kind or a record abiHash equal to a known ABI's. Anything else is refused."""
    by_hash = ABI_HASHES.get(abi_hash.lower()) if isinstance(abi_hash, str) else None
    if version in KNOWN_ABI_KINDS:
        own = KNOWN_ABI_KINDS[version]
        if explicit is not None and explicit != own:
            raise ValueError(f"registry v{version} always uses the v{own} ABI, not abi=v{explicit}")
        if by_hash is not None and by_hash != own:
            raise ValueError(
                f"registry v{version}'s abiHash is the v{by_hash} ABI's; the record is inconsistent"
            )
        return own
    if explicit is not None:
        if explicit not in KNOWN_ABI_KINDS.values():
            raise ValueError(f"unknown ABI kind abi=v{explicit}; this tool knows abi=v1 and abi=v2")
        return KNOWN_ABI_KINDS[explicit]
    if by_hash is not None:
        return by_hash
    raise UnknownRegistryVersion(version, address)


@dataclass(frozen=True)
class RegistrySpec:
    """One VaultRegistry deployment on a chain (D1). ``abi_kind`` 0 means "the version's own"."""

    version: int
    address: str
    deploy_block: int = 0
    abi_kind: int = 0
    block_known: bool = True
    source: str = BUILT_IN

    def __post_init__(self) -> None:
        if isinstance(self.version, bool) or not 1 <= self.version <= MAX_VERSION:
            raise ValueError(f"registry version must be v1..v{MAX_VERSION}")
        object.__setattr__(self, "address", parse_address(self.address))
        if is_placeholder(self.address):
            raise ValueError("a registry address cannot be the zero address")
        if isinstance(self.deploy_block, bool) or not 0 <= self.deploy_block < MAX_BLOCK:
            raise ValueError(f"deploy block must be a whole number from 0 to {MAX_BLOCK - 1}")
        explicit = self.abi_kind or None
        if explicit is not None and explicit not in KNOWN_ABI_KINDS.values():
            raise ValueError(f"unknown ABI kind abi=v{explicit}; this tool knows abi=v1 and abi=v2")
        object.__setattr__(
            self, "abi_kind", abi_kind_for(self.version, explicit=explicit, address=self.address)
        )

    @property
    def name(self) -> str:
        return f"v{self.version}"

    @property
    def kind(self) -> AbiKind:
        return 1 if self.abi_kind == 1 else 2


def sort_registries(specs: Iterable[RegistrySpec]) -> list[RegistrySpec]:
    """Newest first; versions and addresses unique; at most MAX_REGISTRIES."""
    out = sorted(specs, key=lambda s: -s.version)
    versions = [s.version for s in out]
    for v in set(versions):
        if versions.count(v) > 1:
            raise ValueError(f"registry v{v} is given twice; give each version once")
    addresses = [s.address for s in out]
    for a in set(addresses):
        if addresses.count(a) > 1:
            raise ValueError(f"registry address {a} is given twice (as two versions)")
    if len(out) > MAX_REGISTRIES:
        raise ValueError(f"at most {MAX_REGISTRIES} registries can be read in one run")
    return out


@dataclass(frozen=True)
class RegistryFlag:
    """One parsed --registry value; None means "not given"."""

    address: str
    block: int | None
    version: int | None
    abi_kind: int | None


_REGISTRY_FLAG = re.compile(
    r"^(0x[0-9a-fA-F]{40})(?:@([0-9]{1,19}))?(?::v([1-9][0-9]{0,2})(?::abi=v([0-9]{1,3}))?)?$"
)


def parse_registry_flag(text: str) -> RegistryFlag:
    """``ADDRESS[@DEPLOY_BLOCK][:vN[:abi=vK]]`` (D7). Unknown versions without abi= are refused (D6)."""
    m = _REGISTRY_FLAG.match(text) if len(text) <= 128 else None
    if m is None:
        shown = text if len(text) <= 80 else text[:80] + "…"
        raise ValueError(f"cannot read registry {shown!r}. Expected {REGISTRY_FORM}, e.g. 0x…@123:v2")
    address, block_s, version_s, abi_s = m.groups()
    block = int(block_s) if block_s is not None else None
    if block is not None and block >= MAX_BLOCK:
        raise ValueError(f"deploy block {block} is too large. Expected {REGISTRY_FORM}")
    version = int(version_s) if version_s is not None else None
    abi_kind = int(abi_s) if abi_s is not None else None
    if version is not None:
        abi_kind_for(version, explicit=abi_kind, address=address.lower())  # refuse early (D6)
    return RegistryFlag(address.lower(), block, version, abi_kind)


def apply_registry_flags(
    base: Sequence[RegistrySpec], flags: Sequence[RegistryFlag], *, only: bool
) -> tuple[list[RegistrySpec], list[str]]:
    """Merge --registry entries into ``base`` by version (D7), or use only them (``only``).

    Without :vN, an address equal to a base entry's takes that version; any other address is v1 (the
    flag's meaning before versions), with a note. Without @BLOCK, the base entry's block is kept for the
    same (version, address); otherwise history is searched from block 0 (``block_known`` False)."""
    notes: list[str] = []
    by_version = {s.version: s for s in base}
    by_address = {s.address: s for s in base}
    result: dict[int, RegistrySpec] = {} if only else dict(by_version)
    given: set[int] = set()
    for f in flags:
        version = f.version
        if version is None:
            known = by_address.get(f.address)
            if known is not None:
                version = known.version
            else:
                version = 1
                notes.append(
                    f"--registry {f.address} has no version, so it is read as registry v1 (the flag's "
                    "meaning before versions). If it is newer, add :v2 (or its version), e.g. "
                    f"--registry {f.address}@BLOCK:v2."
                )
        if version in given:
            raise ValueError(f"registry v{version} is given twice; give each version once")
        given.add(version)
        same = by_version.get(version)
        same = same if same is not None and same.address == f.address else None
        if f.block is not None:
            block, block_known = f.block, True
        elif same is not None:
            block, block_known = same.deploy_block, same.block_known
        else:
            block, block_known = 0, False
        kind = f.abi_kind if f.abi_kind is not None else (same.abi_kind if same is not None else 0)
        unchanged = same is not None and same.deploy_block == block
        result[version] = RegistrySpec(
            version,
            f.address,
            block,
            abi_kind=kind,
            block_known=block_known,
            source=same.source if unchanged and same is not None else FLAG_SOURCE,
        )
    return sort_registries(result.values()), notes


@dataclass(frozen=True)
class NetworkPreset:
    name: str
    chain_id: int
    # Every VaultRegistry version deployed on this chain, newest first (recover-registry-versions D1).
    registries: tuple[RegistrySpec, ...]
    rpcs: tuple[str, ...]


# Network presets (OpenSpec change target-op-sepolia, design D2). A chain is data, never code.
# Registry lists are copied at release from contracts/deployments/<chainId>.json (v1: the top-level
# address; v2: contracts.vaultRegistryV2; v3 and later: contracts.vaultRegistries.v<N>, proposed) and
# embedded here; that file is never read at runtime (the binary must work outside the repo). The parity
# test (tests/test_registry_versions.py) fails when a record and its preset differ, and prints the lines
# to paste. A preset without a deployment record has no registries, which disables chain mode with a
# clear message. Names and chain IDs must match config/chain-presets.json (parity test).
NETWORKS = {
    "anvil": NetworkPreset(
        name="anvil",
        chain_id=31337,
        # Local development chain; deterministic CREATE2 addresses from contracts/deployments/31337.json.
        registries=(
            RegistrySpec(2, "0xa622c92d3d5b54aea081cf410224a8a2ecb08cb7", 2),
            RegistrySpec(1, "0xb43f58cf17e64b603ae5588a1dd17e96a0849e44", 1),
        ),
        rpcs=("http://127.0.0.1:8545",),
    ),
    "op-sepolia": NetworkPreset(
        name="op-sepolia",
        chain_id=11155420,
        # From contracts/deployments/11155420.json: v2 tx 0x34728ea3…3d02; v1 tx 0xb3608598…0759 (source
        # verified on Blockscout).
        registries=(
            RegistrySpec(2, "0xa622c92d3d5b54aea081cf410224a8a2ecb08cb7", 49755277),
            RegistrySpec(1, "0xb43f58cf17e64b603ae5588a1dd17e96a0849e44", 49568053),
        ),
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
        registries=(),
        rpcs=(
            "https://mainnet.optimism.io",
            "https://optimism-rpc.publicnode.com",
            "https://optimism.drpc.org",
        ),
    ),
    "arbitrum-sepolia": NetworkPreset(
        name="arbitrum-sepolia",
        chain_id=421614,
        registries=(),
        rpcs=(
            "https://sepolia-rollup.arbitrum.io/rpc",
            "https://arbitrum-sepolia-rpc.publicnode.com",
            "https://arbitrum-sepolia.drpc.org",
        ),
    ),
    "arbitrum-one": NetworkPreset(
        name="arbitrum-one",
        chain_id=42161,
        registries=(),
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
    # Newest first (recover-registry-versions D1).
    registries: list[RegistrySpec] = field(default_factory=lambda: list(NETWORKS[DEFAULT_NETWORK].registries))
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
    # Public notes for the startup summary (deprecated flags, a bare --registry read as v1).
    notes: list[str] = field(default_factory=list)
    # Built-in registry versions left out by --registries-only or --deployment-file (startup note).
    dropped_builtin: list[int] = field(default_factory=list)
    rpcs_user_supplied: bool = False

    @property
    def has_registry(self) -> bool:
        """At least one VaultRegistry version is known for this chain."""
        return bool(self.registries)

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

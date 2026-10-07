"""Registry lists from a deployment record or a saved ``/release.json`` (OpenSpec change
recover-registry-versions, D5 and D8).

Read only when the user names a file (``--deployment-file``) and by the preset parity test; a default
run reads no file. Strict and bounded: JSON only, at most MAX_FILE_BYTES, every address, block, version
and ABI validated; unrelated keys (wallets, file lists) are ignored. Error text never echoes raw file
values except through ``repr`` of a short prefix, so a hostile file cannot inject terminal escapes.

Accepted shapes:
- deployment record (``contracts/deployments/<chainId>.json``): top-level ``chainId``; v1 as the
  top-level ``address``/``deployBlock``/``abiHash``; ``contracts.vaultRegistryV<N>`` (v2 today); and the
  proposed ``contracts.vaultRegistries`` map ``{"v<N>": {address, deployBlock, abiHash}}``;
- release file (``/release.json``): ``config.chainId``; ``config.registry`` (v1 or null);
  ``config.registryV<N>``; and the proposed ``config.registries`` list
  ``[{"version": "v<N>", address, deployBlock, abiHash}]``.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .config import (
    BUILT_IN,
    MAX_BLOCK,
    MAX_VERSION,
    RegistrySpec,
    abi_kind_for,
    parse_address,
    sort_registries,
)

MAX_FILE_BYTES = 1 << 20
# Always used with fullmatch: "$" also matches before a trailing newline.
_VERSION_KEY = re.compile(r"v([1-9][0-9]{0,2})")
_RECORD_KEY = re.compile(r"vaultRegistryV([1-9][0-9]{0,2})")
_RELEASE_KEY = re.compile(r"registryV([1-9][0-9]{0,2})")
_HASH = re.compile(r"0x[0-9a-fA-F]{64}")


class DeploymentError(ValueError):
    """A deployment or release file the tool refuses to use."""


def _shown(value: object) -> str:
    text = value if isinstance(value, str) else type(value).__name__
    return repr(text if len(text) <= 40 else text[:40] + "…")


def _version_of(key: object, where: str) -> int:
    m = _VERSION_KEY.fullmatch(key) if isinstance(key, str) else None
    version = int(m.group(1)) if m is not None else 0
    if not 1 <= version <= MAX_VERSION:
        raise DeploymentError(f"{where}: registry version {_shown(key)} must look like v2 or v3")
    return version


def _chain_id(value: object, where: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 < value < MAX_BLOCK:
        raise DeploymentError(f"{where}: chainId must be a positive whole number")
    return value


def _entry(version: int, entry: object, where: str, source: str) -> RegistrySpec:
    if not isinstance(entry, dict):
        raise DeploymentError(f"{where}: registry v{version} must be an object with an address")
    try:
        raw = entry.get("address")
        address = parse_address(raw if isinstance(raw, str) else "")
    except ValueError:
        raise DeploymentError(
            f"{where}: registry v{version} address {_shown(entry.get('address'))} is not a 20-byte hex address"
        ) from None
    block = entry.get("deployBlock")
    if block is not None and (
        isinstance(block, bool) or not isinstance(block, int) or not 0 <= block < MAX_BLOCK
    ):
        raise DeploymentError(f"{where}: registry v{version} deployBlock must be a whole number >= 0")
    abi_hash = entry.get("abiHash")
    if abi_hash is not None and not (isinstance(abi_hash, str) and _HASH.fullmatch(abi_hash)):
        raise DeploymentError(f"{where}: registry v{version} abiHash must be 32 bytes of 0x-hex")
    kind = abi_kind_for(version, abi_hash=abi_hash, address=address)  # UnknownRegistryVersion: refused
    return RegistrySpec(
        version,
        address,
        block if block is not None else 0,
        abi_kind=kind,
        block_known=block is not None,
        source=source,
        trusted=source == BUILT_IN,  # a user's file is supplied data until it matches a built-in (D10)
    )


def _collect(found: list[tuple[int, object]], where: str, source: str) -> list[RegistrySpec]:
    """Build the list; the same version twice must be identical (two key styles), else refused."""
    specs: dict[int, RegistrySpec] = {}
    for version, entry in found:
        spec = _entry(version, entry, where, source)
        if version in specs and specs[version] != spec:
            raise DeploymentError(f"{where}: registry v{version} is listed twice with different values")
        specs[version] = spec
    if not specs:
        raise DeploymentError(f"{where}: no VaultRegistry address in this file")
    try:
        return sort_registries(specs.values())
    except ValueError as e:
        raise DeploymentError(f"{where}: {e}") from None


def parse_record(
    doc: Any, source: str = BUILT_IN, where: str = "deployment record"
) -> tuple[int, list[RegistrySpec]]:
    """A ``contracts/deployments/<chainId>.json`` record: (chain ID, registries newest first)."""
    if not isinstance(doc, dict):
        raise DeploymentError(f"{where}: expected a JSON object")
    chain_id = _chain_id(doc.get("chainId"), where)
    found: list[tuple[int, object]] = []
    if "address" in doc:
        found.append((1, {k: doc.get(k) for k in ("address", "deployBlock", "abiHash") if k in doc}))
    contracts = doc.get("contracts", {})
    if not isinstance(contracts, dict):
        raise DeploymentError(f"{where}: contracts must be an object")
    for key, entry in contracts.items():
        m = _RECORD_KEY.fullmatch(key)
        if m is not None:
            found.append((int(m.group(1)), entry))
    registries = contracts.get("vaultRegistries")
    if registries is not None:
        if not isinstance(registries, dict):
            raise DeploymentError(f"{where}: contracts.vaultRegistries must be an object keyed v3, v4, …")
        for key, entry in registries.items():
            found.append((_version_of(key, where), entry))
    return chain_id, _collect(found, where, source)


def parse_release(doc: Any, source: str, where: str = "release file") -> tuple[int, list[RegistrySpec]]:
    """A saved ``/release.json``: (chain ID, registries newest first)."""
    cfg = doc.get("config") if isinstance(doc, dict) else None
    if not isinstance(cfg, dict):
        raise DeploymentError(f"{where}: expected a config object")
    chain_id = _chain_id(cfg.get("chainId"), where)
    found: list[tuple[int, object]] = []
    if cfg.get("registry") is not None:
        found.append((1, cfg["registry"]))
    for key, entry in cfg.items():
        m = _RELEASE_KEY.fullmatch(key)
        if m is not None and entry is not None:
            found.append((int(m.group(1)), entry))
    listed = cfg.get("registries")
    if listed is not None:
        if not isinstance(listed, list):
            raise DeploymentError(f"{where}: config.registries must be a list")
        for entry in listed:
            version = _version_of(entry.get("version") if isinstance(entry, dict) else None, where)
            found.append((version, entry))
    return chain_id, _collect(found, where, source)


def parse_document(doc: Any, source: str) -> tuple[int, list[RegistrySpec]]:
    """A release file (top-level ``config`` with ``chainId``) or a deployment record (top-level
    ``chainId``); anything else is refused."""
    if isinstance(doc, dict) and isinstance(doc.get("config"), dict) and "chainId" in doc["config"]:
        return parse_release(doc, source)
    if isinstance(doc, dict) and "chainId" in doc:
        return parse_record(doc, source)
    raise DeploymentError(
        "not a CryoShield deployment record (contracts/deployments/<chainId>.json) or release file "
        "(/release.json)"
    )


def _no_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in pairs:
        if k in out:
            raise DeploymentError(
                f"the key {_shown(k)} appears twice in one object; refusing an ambiguous file"
            )
        out[k] = v
    return out


def display_name(path: Path) -> str:
    """The file's name for messages: control and other non-printable characters removed, then quoted."""
    return repr("".join(ch for ch in path.name if ch.isprintable())[:80])


def load_file(path: Path) -> tuple[int, list[RegistrySpec]]:
    """Read ``path`` (at most MAX_FILE_BYTES of UTF-8 JSON) and parse it with ``parse_document``.
    Duplicate keys and nesting deep enough to exhaust the parser are refused."""
    name = display_name(path)
    try:
        with open(path, "rb") as f:
            data = f.read(MAX_FILE_BYTES + 1)
    except OSError as e:
        raise DeploymentError(f"cannot read {name}: {e.strerror or type(e).__name__}") from None
    if len(data) > MAX_FILE_BYTES:
        raise DeploymentError(f"{name} is larger than {MAX_FILE_BYTES} bytes; not a deployment file")
    try:
        doc = json.loads(data.decode("utf-8"), object_pairs_hook=_no_duplicate_keys)
    except DeploymentError:
        raise
    except RecursionError:
        raise DeploymentError(f"{name} is nested too deeply; not a deployment file") from None
    except (UnicodeDecodeError, ValueError):
        raise DeploymentError(f"{name} is not valid JSON") from None
    return parse_document(doc, source=f"from {name}")

"""Minimal, defensive ABI codec for the VaultRegistry v1 and v2 views and their (shared) events.

v2 (OpenSpec change harden-gas-sponsorship; contracts/abi/VaultRegistryV2.json) adds a paged
``resolveLocator(bytes32,uint256,uint256)`` (at most 256 per page), ``locatorLength(bytes32)`` and a
batched ``getVaults(bytes32[])`` (at most 32 ids). ``getVault`` and both events are unchanged.

RPC responses are untrusted: every offset and length is bounds-checked, and oversized values are
rejected. Any problem raises ``AbiError`` and never anything else.
"""

from __future__ import annotations

from .keccak import keccak256

MAX_BLOB = 1024
MAX_CANDIDATES = 16  # v1's per-locator cap
V2_PAGE_SIZE = 256  # v2 clamps resolveLocator's count to this
V2_MAX_IDS_PER_CALL = 32  # v2 getVaults reverts above this
_WORD = 32

SEL_RESOLVE_LOCATOR = keccak256(b"resolveLocator(bytes32)")[:4]  # v1 only
SEL_GET_VAULT = keccak256(b"getVault(bytes32)")[:4]  # v1 and v2
SEL_LOCATOR_LENGTH = keccak256(b"locatorLength(bytes32)")[:4]  # v2
SEL_RESOLVE_LOCATOR_PAGE = keccak256(b"resolveLocator(bytes32,uint256,uint256)")[:4]  # v2
SEL_GET_VAULTS = keccak256(b"getVaults(bytes32[])")[:4]  # v2
TOPIC_VAULT_CREATED = keccak256(b"VaultCreated(bytes32,address,uint32,bytes32)")
TOPIC_VAULT_UPDATED = keccak256(b"VaultUpdated(bytes32,uint32,bytes32)")


class AbiError(Exception):
    pass


def encode_call(selector: bytes, arg32: bytes) -> bytes:
    if len(selector) != 4 or len(arg32) != _WORD:
        raise ValueError("selector must be 4 bytes and argument 32 bytes")
    return selector + arg32


def encode_resolve_page(locator: bytes, start: int, count: int) -> bytes:
    if len(locator) != _WORD or not 0 <= start < 2**256 or not 0 <= count < 2**256:
        raise ValueError("bad resolveLocator page arguments")
    return SEL_RESOLVE_LOCATOR_PAGE + locator + start.to_bytes(_WORD, "big") + count.to_bytes(_WORD, "big")


def encode_get_vaults(ids: list[bytes]) -> bytes:
    if not 1 <= len(ids) <= V2_MAX_IDS_PER_CALL or any(len(i) != _WORD for i in ids):
        raise ValueError(f"getVaults takes 1..{V2_MAX_IDS_PER_CALL} ids of 32 bytes")
    return SEL_GET_VAULTS + (_WORD).to_bytes(_WORD, "big") + len(ids).to_bytes(_WORD, "big") + b"".join(ids)


def _word(data: bytes, offset: int) -> int:
    if offset < 0 or offset + _WORD > len(data):
        raise AbiError("read past end")
    return int.from_bytes(data[offset : offset + _WORD], "big")


def _offset(data: bytes, at: int) -> int:
    off = _word(data, at)
    if off % _WORD or off >= len(data):
        raise AbiError("bad offset")
    return off


def decode_uint256(data: bytes) -> int:
    if len(data) != _WORD:
        raise AbiError("bad uint256")
    return _word(data, 0)


def decode_bytes32_array(data: bytes, max_entries: int = MAX_CANDIDATES) -> list[bytes]:
    off = _offset(data, 0)
    n = _word(data, off)
    if n > max_entries:
        raise AbiError("too many entries")
    start = off + _WORD
    if start + n * _WORD > len(data):
        raise AbiError("truncated array")
    return [data[start + i * _WORD : start + (i + 1) * _WORD] for i in range(n)]


def decode_vault(data: bytes) -> tuple[str, bytes, int]:
    """Decode ``(address owner, bytes blob, uint32 version)``."""
    return _decode_vault_at(data, 0)


def _decode_vault_at(data: bytes, base: int) -> tuple[str, bytes, int]:
    """One ``(address, bytes, uint32)`` tuple whose head starts at ``base`` (offsets relative to it)."""
    raw_owner = _word(data, base)
    if raw_owner >> 160:
        raise AbiError("dirty address")
    rel = _word(data, base + _WORD)
    if rel % _WORD or rel < 3 * _WORD or base + rel >= len(data):
        raise AbiError("bad offset")
    off = base + rel
    version = _word(data, base + 2 * _WORD)
    if version >> 32:
        raise AbiError("version overflow")
    n = _word(data, off)
    if n > MAX_BLOB:
        raise AbiError("blob too large")
    start = off + _WORD
    if start + n > len(data):
        raise AbiError("truncated blob")
    return "0x" + raw_owner.to_bytes(20, "big").hex(), data[start : start + n], version


def decode_vaults(data: bytes, expected: int) -> list[tuple[str, bytes, int]]:
    """Decode v2 ``getVaults``: ``tuple(address owner, bytes blob, uint32 version)[]``.

    The answer must hold exactly ``expected`` entries (one per requested id, in order); anything else
    is a malformed or lying answer and is rejected whole."""
    if not 0 <= expected <= V2_MAX_IDS_PER_CALL:
        raise ValueError("bad expected count")
    off = _offset(data, 0)
    n = _word(data, off)
    if n != expected:
        raise AbiError("wrong number of vaults")
    heads = off + _WORD
    out = []
    for i in range(n):
        rel = _word(data, heads + i * _WORD)
        if rel % _WORD or heads + rel >= len(data):
            raise AbiError("bad offset")
        out.append(_decode_vault_at(data, heads + rel))
    return out


def decode_log_hash(data: bytes) -> tuple[int, bytes]:
    """Non-indexed event data ``(uint32 version, bytes32 blobHash)`` for both vault events."""
    if len(data) != 2 * _WORD:
        raise AbiError("bad event data")
    version = _word(data, 0)
    if version >> 32:
        raise AbiError("version overflow")
    return version, data[_WORD : 2 * _WORD]

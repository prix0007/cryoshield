"""Minimal, defensive ABI codec for the two VaultRegistry views and its events.

RPC responses are untrusted: every offset and length is bounds-checked, and oversized values are
rejected. Any problem raises ``AbiError`` and never anything else.
"""

from __future__ import annotations

from .keccak import keccak256

MAX_BLOB = 1024
MAX_CANDIDATES = 16
_WORD = 32

SEL_RESOLVE_LOCATOR = keccak256(b"resolveLocator(bytes32)")[:4]
SEL_GET_VAULT = keccak256(b"getVault(bytes32)")[:4]
TOPIC_VAULT_CREATED = keccak256(b"VaultCreated(bytes32,address,uint32,bytes32)")
TOPIC_VAULT_UPDATED = keccak256(b"VaultUpdated(bytes32,uint32,bytes32)")


class AbiError(Exception):
    pass


def encode_call(selector: bytes, arg32: bytes) -> bytes:
    if len(selector) != 4 or len(arg32) != _WORD:
        raise ValueError("selector must be 4 bytes and argument 32 bytes")
    return selector + arg32


def _word(data: bytes, offset: int) -> int:
    if offset < 0 or offset + _WORD > len(data):
        raise AbiError("read past end")
    return int.from_bytes(data[offset : offset + _WORD], "big")


def _offset(data: bytes, at: int) -> int:
    off = _word(data, at)
    if off % _WORD or off >= len(data):
        raise AbiError("bad offset")
    return off


def decode_bytes32_array(data: bytes) -> list[bytes]:
    off = _offset(data, 0)
    n = _word(data, off)
    if n > MAX_CANDIDATES:
        raise AbiError("too many entries")
    start = off + _WORD
    if start + n * _WORD > len(data):
        raise AbiError("truncated array")
    return [data[start + i * _WORD : start + (i + 1) * _WORD] for i in range(n)]


def decode_vault(data: bytes) -> tuple[str, bytes, int]:
    """Decode ``(address owner, bytes blob, uint32 version)``."""
    raw_owner = _word(data, 0)
    if raw_owner >> 160:
        raise AbiError("dirty address")
    off = _offset(data, _WORD)
    if off < 3 * _WORD:
        raise AbiError("bad offset")
    version = _word(data, 2 * _WORD)
    if version >> 32:
        raise AbiError("version overflow")
    n = _word(data, off)
    if n > MAX_BLOB:
        raise AbiError("blob too large")
    start = off + _WORD
    if start + n > len(data):
        raise AbiError("truncated blob")
    return "0x" + raw_owner.to_bytes(20, "big").hex(), data[start : start + n], version


def decode_log_hash(data: bytes) -> tuple[int, bytes]:
    """Non-indexed event data ``(uint32 version, bytes32 blobHash)`` for both vault events."""
    if len(data) != 2 * _WORD:
        raise AbiError("bad event data")
    version = _word(data, 0)
    if version >> 32:
        raise AbiError("version overflow")
    return version, data[_WORD : 2 * _WORD]

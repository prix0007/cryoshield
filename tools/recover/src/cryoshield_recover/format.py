"""Bounds-checked decoder for vault blob format v1 (docs/spec/vault-format-v1.md §5).

Decoding follows the normative check order of §5.1 and raises ``VaultError`` with the first failing
code. No cryptography happens here.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from .errors import VaultError

MAGIC = b"CRYO"
VERSION = 0x01
SUITE = 0x01
MODE_ANY_OF_N = 0x01
MODE_SHAMIR = 0x02
MAX_BLOB = 1024
MIN_KEYS, MAX_KEYS = 2, 8
NONCE_LEN = 12
TAG_LEN = 16
WRAP_SALT_LEN = 32
WRAPPED_LEN = {MODE_ANY_OF_N: 48, MODE_SHAMIR: 49}


@dataclass(frozen=True)
class Entry:
    cred_id: bytes
    wrap_nonce: bytes
    wrapped: bytes


@dataclass(frozen=True)
class DecodedVault:
    raw: bytes
    mode: int
    threshold: int
    count: int
    rp_id: str
    wrap_salt: bytes
    entries: tuple[Entry, ...]
    header_length: int
    payload_offset: int

    @property
    def payload_nonce(self) -> bytes:
        return self.raw[self.payload_offset : self.payload_offset + NONCE_LEN]

    @property
    def payload_ct(self) -> bytes:
        return self.raw[self.payload_offset + NONCE_LEN :]


class _Reader:
    def __init__(self, data: bytes) -> None:
        self.data = data
        self.pos = 0

    def take(self, n: int) -> bytes:
        if n < 0 or self.pos + n > len(self.data):
            raise VaultError("MALFORMED")
        out = self.data[self.pos : self.pos + n]
        self.pos += n
        return out

    def u8(self) -> int:
        return self.take(1)[0]


def decode_blob(blob: bytes | bytearray) -> DecodedVault:
    data = bytes(blob)
    if len(data) < 4:
        raise VaultError("MALFORMED")
    if data[:4] != MAGIC:
        raise VaultError("BAD_MAGIC")
    r = _Reader(data)
    r.take(4)
    if r.u8() != VERSION:
        raise VaultError("UNSUPPORTED_VERSION")
    if r.u8() != SUITE:
        raise VaultError("UNSUPPORTED_SUITE")
    mode = r.u8()
    if mode not in (MODE_ANY_OF_N, MODE_SHAMIR):
        raise VaultError("UNSUPPORTED_MODE")
    if len(data) > MAX_BLOB:
        raise VaultError("MALFORMED")
    threshold = r.u8()
    count = r.u8()
    if not MIN_KEYS <= count <= MAX_KEYS:
        raise VaultError("MALFORMED")
    if mode == MODE_ANY_OF_N and threshold != 1:
        raise VaultError("MALFORMED")
    if mode == MODE_SHAMIR and not 2 <= threshold <= count:
        raise VaultError("MALFORMED")
    rp_len = r.u8()
    if not 1 <= rp_len <= 64:
        raise VaultError("MALFORMED")
    rp_raw = r.take(rp_len)
    if any(b < 0x21 or b > 0x7E for b in rp_raw):
        raise VaultError("MALFORMED")
    wrap_salt = r.take(WRAP_SALT_LEN)
    header_length = r.pos
    entries: list[Entry] = []
    seen: set[bytes] = set()
    for _ in range(count):
        cred_len = r.u8()
        if not 1 <= cred_len <= 128:
            raise VaultError("MALFORMED")
        cred_id = r.take(cred_len)
        if cred_id in seen:
            raise VaultError("MALFORMED")
        seen.add(cred_id)
        nonce = r.take(NONCE_LEN)
        wrapped = r.take(WRAPPED_LEN[mode])
        entries.append(Entry(cred_id, nonce, wrapped))
    payload_offset = r.pos
    remaining = len(data) - payload_offset
    if remaining < NONCE_LEN + 64 + TAG_LEN or (remaining - NONCE_LEN - TAG_LEN) % 64 != 0:
        raise VaultError("MALFORMED")
    return DecodedVault(
        raw=data,
        mode=mode,
        threshold=threshold,
        count=count,
        rp_id=rp_raw.decode("ascii"),
        wrap_salt=wrap_salt,
        entries=tuple(entries),
        header_length=header_length,
        payload_offset=payload_offset,
    )


VAULT_ID_LEN = 32


def wrap_aad(v: DecodedVault, index: int, vault_id: bytes) -> bytes:
    """§6.3: immutable header fields || vaultId || u8(i) || u8(len(credId)) || credId (excludes M, N)."""
    rp = v.rp_id.encode("ascii")
    cred = v.entries[index].cred_id
    return (
        MAGIC
        + bytes([VERSION, SUITE, v.mode, len(rp)])
        + rp
        + v.wrap_salt
        + vault_id
        + bytes([index, len(cred)])
        + cred
    )


def payload_aad(v: DecodedVault, vault_id: bytes) -> bytes:
    """§6.2: every byte before the payload nonce, then the 32-byte vaultId (§4.1)."""
    return v.raw[: v.payload_offset] + vault_id


def max_payload_bytes(rp_id: str, cred_ids: Sequence[bytes], mode: int = MODE_ANY_OF_N) -> int:
    """§7 capacity formula."""
    w = WRAPPED_LEN[mode]
    overhead = 42 + len(rp_id.encode("ascii")) + sum(1 + len(c) + NONCE_LEN + w for c in cred_ids)
    overhead += NONCE_LEN + TAG_LEN
    return max(0, 64 * ((MAX_BLOB - overhead) // 64) - 2)

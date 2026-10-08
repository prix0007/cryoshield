"""Opening vaults and selecting among candidates (docs/spec/vault-format-v1.md §6.5, §8)."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from . import shamir
from .derive import derive_wrap_key
from .errors import VaultError
from .format import MODE_ANY_OF_N, VAULT_ID_LEN, DecodedVault, decode_blob, payload_aad, wrap_aad
from .secure import wipe, wipe_all


@dataclass
class UnlockKey:
    """One PRF output (32 bytes, mutable so it can be wiped) and optionally its credential ID."""

    prf: bytearray = field(repr=False)
    cred_id: bytes | None = None


def validate_vault_id(vault_id: bytes | bytearray | None) -> bytes:
    """§4.1: exactly 32 bytes and not all zeros, else INVALID_ARGUMENT. The vaultId is never read from
    the blob; callers pass the id under which they found it (registry key or Arweave tag)."""
    if vault_id is None or len(vault_id) != VAULT_ID_LEN or not any(vault_id):
        raise VaultError("INVALID_ARGUMENT")
    return bytes(vault_id)


def _unwrap(d: DecodedVault, index: int, wrap_key: bytearray, vault_id: bytes) -> bytearray | None:
    e = d.entries[index]
    try:
        return bytearray(
            AESGCM(bytes(wrap_key)).decrypt(e.wrap_nonce, e.wrapped, wrap_aad(d, index, vault_id))
        )
    except InvalidTag:
        return None


def _candidate_entries(d: DecodedVault, key: UnlockKey) -> list[int]:
    if key.cred_id is None:
        return list(range(len(d.entries)))
    return [i for i, e in enumerate(d.entries) if e.cred_id == key.cred_id]


def matching_entries(d: DecodedVault, key: UnlockKey, vault_id: bytes) -> list[int]:
    """Indices of entries this key unwraps. Does not wipe ``key``."""
    found: list[int] = []
    wk = derive_wrap_key(key.prf, d.wrap_salt)
    try:
        for i in _candidate_entries(d, key):
            pt = _unwrap(d, i, wk, vault_id)
            if pt is not None:
                wipe(pt)
                found.append(i)
    finally:
        wipe(wk)
    return found


def _unpad(padded: bytearray) -> bytearray:
    if len(padded) < 2:
        raise VaultError("MALFORMED")
    n = (padded[0] << 8) | padded[1]
    if n > len(padded) - 2 or any(padded[2 + n :]):
        raise VaultError("MALFORMED")
    return bytearray(padded[2 : 2 + n])


def _data_key(d: DecodedVault, keys: Sequence[UnlockKey], vault_id: bytes) -> bytearray:
    if d.mode == MODE_ANY_OF_N:
        for key in keys:
            wk = derive_wrap_key(key.prf, d.wrap_salt)
            try:
                for i in _candidate_entries(d, key):
                    pt = _unwrap(d, i, wk, vault_id)
                    if pt is not None:
                        if len(pt) != 32:
                            wipe(pt)
                            raise VaultError("MALFORMED")
                        return pt
            finally:
                wipe(wk)
        raise VaultError("NO_MATCHING_KEY")

    shares: dict[int, bytearray] = {}
    try:
        for key in keys:
            wk = derive_wrap_key(key.prf, d.wrap_salt)
            try:
                for i in _candidate_entries(d, key):
                    if i in shares:
                        continue
                    pt = _unwrap(d, i, wk, vault_id)
                    if pt is not None:
                        shares[i] = pt
            finally:
                wipe(wk)
        if not shares:
            raise VaultError("NO_MATCHING_KEY")
        if len(shares) < d.threshold:
            raise VaultError("INSUFFICIENT_SHARES")
        chosen = sorted(shares)[: d.threshold]
        points: list[tuple[int, bytes | bytearray]] = []
        for i in chosen:
            s = shares[i]
            if len(s) != 33:
                raise VaultError("MALFORMED")
            points.append((s[0], s[1:]))
        return shamir.combine(points)
    finally:
        wipe_all(shares.values())


def open_decoded(d: DecodedVault, keys: Sequence[UnlockKey], vault_id: bytes) -> bytearray:
    """Open an already decoded vault under ``vault_id``. Does not wipe the caller's keys; wipes all
    intermediates."""
    vault_id = validate_vault_id(vault_id)
    data_key = _data_key(d, keys, vault_id)
    padded: bytearray | None = None
    try:
        try:
            padded = bytearray(
                AESGCM(bytes(data_key)).decrypt(d.payload_nonce, d.payload_ct, payload_aad(d, vault_id))
            )
        except InvalidTag:
            raise VaultError("AUTH_FAILED") from None
        return _unpad(padded)
    finally:
        wipe(data_key)
        wipe(padded)


def open_vault(blob: bytes | bytearray, keys: Sequence[UnlockKey], vault_id: bytes) -> bytearray:
    """Validate the vaultId, decode, and open (§6.5). Wipes every caller PRF buffer on return or
    failure (§9)."""
    try:
        vault_id = validate_vault_id(vault_id)
        return open_decoded(decode_blob(blob), keys, vault_id)
    finally:
        wipe_all(k.prf for k in keys)


def select_vault(
    candidates: Sequence[tuple[bytes, bytes | bytearray]], prf: bytearray
) -> tuple[int, bytes, bytearray]:
    """§8: the first ``(vaultId, blob)`` pair that opens completely under its own vaultId.

    A byte-identical clone under another vaultId never authenticates and is skipped. Wipes ``prf``.
    """
    try:
        for index, (vault_id, blob) in enumerate(candidates):
            try:
                vid = validate_vault_id(vault_id)
                return index, vid, open_decoded(decode_blob(blob), [UnlockKey(prf)], vid)
            except VaultError:
                continue
        raise VaultError("NO_MATCHING_VAULT")
    finally:
        wipe(prf)

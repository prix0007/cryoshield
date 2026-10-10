"""TEST-ONLY vault writer, used to check the write-side vectors and build integration fixtures.

The shipped recovery tool never creates or modifies vaults. This module lives under tests/ so it is
not packaged; it reuses the shipped primitives (derive, format, vault) so that the vectors cross-check
them byte for byte.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from support.vectors import h

from cryoshield_recover.derive import derive_wrap_key
from cryoshield_recover.errors import VaultError
from cryoshield_recover.format import (
    MAGIC,
    MAX_BLOB,
    MAX_KEYS,
    MIN_KEYS,
    MODE_ANY_OF_N,
    MODE_SHAMIR,
    SUITE,
    VERSION,
    DecodedVault,
    decode_blob,
    max_payload_bytes,
    wrap_aad,
)
from cryoshield_recover.shamir import gf_mul
from cryoshield_recover.vault import UnlockKey, _data_key, validate_vault_id


class FixedRng:
    def __init__(self, data: bytes) -> None:
        self.data = data
        self.pos = 0

    def take(self, n: int) -> bytes:
        if self.pos + n > len(self.data):
            raise AssertionError("vector rng exhausted")
        out = self.data[self.pos : self.pos + n]
        self.pos += n
        return out


class ExhaustedRng(FixedRng):
    def __init__(self) -> None:
        super().__init__(b"")


def padded_length_for(rp_id: str, cred_ids: Sequence[bytes], mode: int) -> int:
    """Spec §6.1/§7 (pad-to-max-payload): every encoder pads to 64 * floor((1024 - overhead) / 64) bytes."""
    cap = max_payload_bytes(rp_id, cred_ids, mode)
    return cap + 2 if cap > 0 else 0


def _pad(secret: bytes, target: int) -> bytes:
    """u16be(len) || secret || zeros, to exactly `target` bytes (the key set's maximum)."""
    n = len(secret)
    assert target % 64 == 0 and target >= 2 + n
    return n.to_bytes(2, "big") + secret + b"\x00" * (target - 2 - n)


def _check_rp(rp_id: str) -> None:
    raw = rp_id.encode("ascii", errors="replace")
    if not 1 <= len(raw) <= 64 or any(b < 0x21 or b > 0x7E for b in raw):
        raise VaultError("INVALID_ARGUMENT")


def _check_cred(cred_id: bytes) -> None:
    if not 1 <= len(cred_id) <= 128:
        raise VaultError("INVALID_ARGUMENT")


def _header(mode: int, m: int, n: int, rp_id: str, wrap_salt: bytes) -> bytes:
    rp = rp_id.encode("ascii")
    return MAGIC + bytes([VERSION, SUITE, mode, m, n, len(rp)]) + rp + wrap_salt


def _entry_aad(mode: int, rp_id: str, wrap_salt: bytes, vault_id: bytes, index: int, cred_id: bytes) -> bytes:
    rp = rp_id.encode("ascii")
    return (
        MAGIC
        + bytes([VERSION, SUITE, mode, len(rp)])
        + rp
        + wrap_salt
        + vault_id
        + bytes([index, len(cred_id)])
        + cred_id
    )


def create(
    *,
    vault_id: bytes,
    rp_id: str,
    credentials: Sequence[tuple[bytes, bytearray]],
    secret: bytes,
    mode: int,
    threshold: int,
    rng: FixedRng,
    shares: Sequence[tuple[int, bytes]] | None = None,
) -> bytes:
    n = len(credentials)
    if n < MIN_KEYS:
        raise VaultError("TOO_FEW_KEYS")
    if n > MAX_KEYS:
        raise VaultError("TOO_MANY_KEYS")
    validate_vault_id(vault_id)  # §4.1: right after the key-count checks
    _check_rp(rp_id)
    ids = [c for c, _ in credentials]
    for c in ids:
        _check_cred(c)
    if len(set(ids)) != n or any(len(p) != 32 for _, p in credentials):
        raise VaultError("INVALID_ARGUMENT")
    if len({bytes(p) for _, p in credentials}) != n:  # one key enrolled twice (REC-L2)
        raise VaultError("INVALID_ARGUMENT")
    if mode == MODE_ANY_OF_N and threshold != 1:
        raise VaultError("INVALID_ARGUMENT")
    if mode == MODE_SHAMIR and not 2 <= threshold <= n:
        raise VaultError("INVALID_ARGUMENT")
    if not secret:
        raise VaultError("INVALID_ARGUMENT")
    cap = max_payload_bytes(rp_id, ids, mode)
    if len(secret) > cap:
        raise VaultError("VAULT_TOO_LARGE", max_payload_bytes=cap)

    wrap_salt = rng.take(32)
    data_key = rng.take(32)
    nonces = [rng.take(12) for _ in range(n)]
    payload_nonce = rng.take(12)
    if mode == MODE_SHAMIR:
        assert shares is not None and len(shares) == n
        plaintexts = [bytes([x]) + y for x, y in shares]
    else:
        plaintexts = [data_key] * n

    out = bytearray(_header(mode, threshold, n, rp_id, wrap_salt))
    for i, (cred_id, prf) in enumerate(credentials):
        wk = bytes(derive_wrap_key(prf, wrap_salt))
        wrapped = AESGCM(wk).encrypt(
            nonces[i], plaintexts[i], _entry_aad(mode, rp_id, wrap_salt, vault_id, i, cred_id)
        )
        out += bytes([len(cred_id)]) + cred_id + nonces[i] + wrapped
    padded = _pad(secret, cap + 2)
    out += payload_nonce + AESGCM(data_key).encrypt(payload_nonce, padded, bytes(out) + vault_id)
    assert len(out) <= MAX_BLOB
    return bytes(out)


def shamir_split_from_vector(v: dict[str, Any]) -> list[tuple[int, bytes]]:
    """Recompute shares from the vector's x-coordinates and shamirRng coefficients (§6.4, §11)."""
    m = v["threshold"]
    coeffs = h(v["shamirRng"])[255:]
    data_key = h(v["dataKey"])
    out = []
    for s in v["shamir"]["shares"]:
        x = s["x"]
        y = bytearray()
        for j, sj in enumerate(data_key):
            acc, xp = sj, 1
            for k in range(1, m):
                xp = gf_mul(xp, x)
                acc ^= gf_mul(coeffs[j * (m - 1) + (k - 1)], xp)
            y.append(acc)
        out.append((x, bytes(y)))
    return out


def create_from_vector(v: dict[str, Any]) -> bytes:
    creds = [(h(c["id"]), bytearray(h(c["prf"]))) for c in v["credentials"]]
    shares = shamir_split_from_vector(v) if v["mode"] == MODE_SHAMIR else None
    return create(
        vault_id=h(v["vaultId"]),
        rp_id=v["rpId"],
        credentials=creds,
        secret=h(v["secret"]),
        mode=v["mode"],
        threshold=v["threshold"],
        rng=FixedRng(h(v["rng"])),
        shares=shares,
    )


def _reencrypt(
    prefix: bytes, vault_id: bytes, data_key: bytes, secret: bytes, old_nonce: bytes, rng: FixedRng, target: int
) -> bytes:
    nonce = rng.take(12)
    if nonce == old_nonce:  # §6.6/§6.7: the new payload nonce MUST differ
        raise AssertionError("payload nonce reuse")
    return prefix + nonce + AESGCM(data_key).encrypt(nonce, _pad(secret, target), prefix + vault_id)


def _open_parts(d: DecodedVault, keys: Sequence[UnlockKey], vault_id: bytes) -> tuple[bytes, bytes]:
    from cryoshield_recover.vault import open_decoded

    secret = bytes(open_decoded(d, keys, vault_id))
    return bytes(_data_key(d, keys, vault_id)), secret


def add_key(
    blob: bytes, key: UnlockKey, vault_id: bytes, new_id: bytes, new_prf: bytearray, rng: FixedRng
) -> bytes:
    vault_id = validate_vault_id(vault_id)
    d = decode_blob(blob)
    if d.mode == MODE_SHAMIR:
        raise VaultError("INVALID_ARGUMENT")
    if d.count + 1 > MAX_KEYS:
        raise VaultError("TOO_MANY_KEYS")
    if not 1 <= len(new_id) <= 128 or any(e.cred_id == new_id for e in d.entries) or len(new_prf) != 32:
        raise VaultError("INVALID_ARGUMENT")
    data_key, secret = _open_parts(d, [key], vault_id)
    new_ids = [e.cred_id for e in d.entries] + [new_id]
    cap = max_payload_bytes(d.rp_id, new_ids, d.mode)
    if len(secret) > cap:  # §6.6: the secret must fit the N + 1 maximum
        raise VaultError("VAULT_TOO_LARGE", max_payload_bytes=cap)
    header = _header(d.mode, d.threshold, d.count + 1, d.rp_id, d.wrap_salt)
    entries = blob[d.header_length : d.payload_offset]
    nonce = rng.take(12)
    wk = bytes(derive_wrap_key(new_prf, d.wrap_salt))
    aad = _entry_aad(d.mode, d.rp_id, d.wrap_salt, vault_id, d.count, new_id)
    new_entry = bytes([len(new_id)]) + new_id + nonce + AESGCM(wk).encrypt(nonce, data_key, aad)
    return _reencrypt(header + entries + new_entry, vault_id, data_key, secret, d.payload_nonce, rng, cap + 2)


def update_payload(
    blob: bytes, keys: Sequence[UnlockKey], vault_id: bytes, new_secret: bytes, rng: FixedRng
) -> bytes:
    vault_id = validate_vault_id(vault_id)
    d = decode_blob(blob)
    data_key, _ = _open_parts(d, keys, vault_id)
    if not new_secret:
        raise VaultError("INVALID_ARGUMENT")
    cap = max_payload_bytes(d.rp_id, [e.cred_id for e in d.entries], d.mode)
    if len(new_secret) > cap:
        raise VaultError("VAULT_TOO_LARGE", max_payload_bytes=cap)
    return _reencrypt(blob[: d.payload_offset], vault_id, data_key, new_secret, d.payload_nonce, rng, cap + 2)


__all__ = ["wrap_aad"]

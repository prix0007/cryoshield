"""Key derivation from a single PRF output (docs/spec/vault-format-v1.md §3–§4)."""

from __future__ import annotations

import hashlib

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

LOCATOR_SALT_INPUT = b"cryoshield/v1/locator-salt"
INFO_LOCATOR = b"cryoshield/v1/locator"
INFO_WRAP = b"cryoshield/v1/wrap"
PRF_LEN = 32

_LOCATOR_SALT = hashlib.sha256(LOCATOR_SALT_INPUT).digest()
_CTAP_SALT = hashlib.sha256(b"WebAuthn PRF" + b"\x00" + _LOCATOR_SALT).digest()


def locator_salt() -> bytes:
    """The single WebAuthn PRF input: SHA-256("cryoshield/v1/locator-salt")."""
    return _LOCATOR_SALT


def ctap_salt() -> bytes:
    """The CTAP2 hmac-secret salt equal to the browser PRF input above (§3)."""
    return _CTAP_SALT


def _check_prf(prf: bytes | bytearray) -> None:
    if len(prf) != PRF_LEN:
        raise ValueError("PRF output must be 32 bytes")


def _hkdf(ikm: bytes | bytearray, salt: bytes | None, info: bytes) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=salt, info=info).derive(bytes(ikm))


def derive_locator(prf: bytes | bytearray) -> bytes:
    """Public on-chain lookup key. Leaves ``prf`` intact (single-tap flow still needs it)."""
    _check_prf(prf)
    return _hkdf(prf, None, INFO_LOCATOR)


def derive_wrap_key(prf: bytes | bytearray, wrap_salt: bytes) -> bytearray:
    """Secret wrapping key. The caller must wipe the result."""
    _check_prf(prf)
    if len(wrap_salt) != 32:
        raise ValueError("wrap salt must be 32 bytes")
    return bytearray(_hkdf(prf, wrap_salt, INFO_WRAP))

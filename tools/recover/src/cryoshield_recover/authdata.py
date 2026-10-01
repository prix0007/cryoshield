"""User-verification check on WebAuthn/CTAP2 authenticator data (vault-format-v1 §3.1).

A PRF/hmac-secret output obtained without UV comes from CredRandomWithoutUV and can never open a vault,
so it is rejected before any derivation.
"""

from __future__ import annotations

from .errors import VaultError

UV_FLAG = 0x04
_MIN_LEN = 32 + 1 + 4  # rpIdHash || flags || signCount


def require_user_verified(authenticator_data: bytes) -> None:
    if len(authenticator_data) < _MIN_LEN:
        raise VaultError("INVALID_ARGUMENT")
    if not authenticator_data[32] & UV_FLAG:
        raise VaultError("USER_NOT_VERIFIED")

"""Error types.

``VaultError`` mirrors the vault-format error codes (docs/spec/vault-format-v1.md §10). Its message is
exactly the code, so errors never reveal which cryptographic step failed.

``RecoveryError`` is a user-facing failure with a plain-language message and a documented exit code.
"""

from __future__ import annotations

from enum import IntEnum

VAULT_ERROR_CODES = frozenset(
    {
        "BAD_MAGIC",
        "UNSUPPORTED_VERSION",
        "UNSUPPORTED_SUITE",
        "UNSUPPORTED_MODE",
        "MALFORMED",
        "VAULT_TOO_LARGE",
        "TOO_FEW_KEYS",
        "TOO_MANY_KEYS",
        "INVALID_ARGUMENT",
        "NO_MATCHING_KEY",
        "INSUFFICIENT_SHARES",
        "AUTH_FAILED",
        "NO_MATCHING_VAULT",
        "USER_NOT_VERIFIED",
    }
)


class VaultError(Exception):
    def __init__(self, code: str, *, max_payload_bytes: int | None = None) -> None:
        if code not in VAULT_ERROR_CODES:
            raise ValueError(f"unknown vault error code {code!r}")
        super().__init__(code)
        self.code = code
        self.max_payload_bytes = max_payload_bytes

    @property
    def detail(self) -> str:
        if self.code == "VAULT_TOO_LARGE" and self.max_payload_bytes is not None:
            return f"vault too large: maximum payload is {self.max_payload_bytes} bytes"
        return self.code


class ExitCode(IntEnum):
    OK = 0
    USAGE = 2
    NO_DEVICE = 3
    PIN_FAILED = 4
    NO_CREDENTIAL = 5
    NETWORK_UNAVAILABLE = 6
    NO_MATCHING_VAULT = 7
    UNSUPPORTED_KEY = 8
    OUTPUT_REFUSED = 9
    INTERNAL = 10
    CANCELLED = 11
    AMBIGUOUS = 12


class RecoveryError(Exception):
    """A failure the user can act on. ``message`` must never contain secret material."""

    def __init__(self, exit_code: ExitCode, message: str) -> None:
        super().__init__(message)
        self.exit_code = exit_code
        self.message = message

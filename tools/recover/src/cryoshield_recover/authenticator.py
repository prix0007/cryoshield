"""Hardware-key access: one CTAP2 ceremony with the PRF (hmac-secret) extension and mandatory UV.

python-fido2's ``prf`` extension maps our single PRF input to the CTAP2 hmac-secret salt with
SHA-256("WebAuthn PRF" || 0x00 || input), exactly the vault-format-v1 §3 mapping (pinned by a test).
"""

from __future__ import annotations

import logging
import os
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

from .authdata import require_user_verified
from .derive import PRF_LEN, locator_salt
from .errors import ExitCode, RecoveryError, VaultError
from .secure import wipe

log = logging.getLogger(__name__)

CEREMONY_TIMEOUT_MS = 60_000
MAX_PIN_ATTEMPTS = 3


@dataclass
class Assertion:
    """One credential's PRF output from a ceremony. ``prf`` is wiped by the consumer."""

    cred_id: bytes
    prf: bytearray = field(repr=False)


class PrfSource(Protocol):
    def get(self, rp_id: str, allow: Sequence[bytes] | None) -> list[Assertion]:
        """One ceremony. ``allow`` empty/None means discoverable credentials (keyless lookup)."""
        ...


class Prompter(Protocol):
    def info(self, msg: str) -> None: ...
    def ask_pin(self, retries: int | None) -> str | None: ...


def request_options(rp_id: str, allow: Sequence[bytes] | None) -> Any:
    from fido2.webauthn import (
        PublicKeyCredentialDescriptor,
        PublicKeyCredentialRequestOptions,
        PublicKeyCredentialType,
        UserVerificationRequirement,
    )

    return PublicKeyCredentialRequestOptions(
        challenge=os.urandom(32),  # no relying party verifies it; required by the protocol
        timeout=CEREMONY_TIMEOUT_MS,
        rp_id=rp_id,
        allow_credentials=[
            PublicKeyCredentialDescriptor(type=PublicKeyCredentialType.PUBLIC_KEY, id=bytes(c))
            for c in allow or []
        ]
        or None,
        user_verification=UserVerificationRequirement.REQUIRED,
        extensions={"prf": {"eval": {"first": locator_salt()}}},
    )


def extract(selection: Any) -> list[Assertion]:
    """Turn an AssertionSelection into PRF outputs, rejecting any non-UV assertion (§3.1)."""
    out: list[Assertion] = []
    try:
        for i, a in enumerate(selection.get_assertions()):
            try:
                require_user_verified(bytes(a.auth_data))
            except VaultError as e:
                if e.code == "USER_NOT_VERIFIED":
                    raise RecoveryError(
                        ExitCode.UNSUPPORTED_KEY,
                        "Your key answered without verifying your PIN, so its secret would not match the vault. "
                        "Set a PIN on the key (e.g. with Yubico Authenticator) and try again.",
                    ) from None
                raise
            resp = selection.get_response(i)
            prf_out = getattr(resp.client_extension_results, "prf", None)
            results = getattr(prf_out, "results", None)
            first = getattr(results, "first", None)
            if not isinstance(first, bytes | bytearray) or len(first) != PRF_LEN:
                raise RecoveryError(
                    ExitCode.UNSUPPORTED_KEY,
                    "The key did not return a PRF (hmac-secret) result. It may not support CryoShield "
                    "(YubiKey 5 with firmware 5.2 or newer is required).",
                )
            out.append(Assertion(cred_id=bytes(a.credential["id"]), prf=bytearray(first)))
    except BaseException:
        for a in out:
            wipe(a.prf)
        raise
    return out


class _Interaction:
    def __init__(self, prompter: Prompter, retries: Callable[[], int | None]) -> None:
        self.prompter = prompter
        self.retries = retries

    def prompt_up(self) -> None:
        self.prompter.info("Touch your security key now.")

    def request_pin(self, permissions: Any, rp_id: str | None) -> str | None:
        return self.prompter.ask_pin(self.retries())

    def request_uv(self, permissions: Any, rp_id: str | None) -> bool:
        self.prompter.info("Verify yourself on the key (fingerprint or PIN).")
        return True


def _list_devices() -> list[Any]:
    devices: list[Any] = []
    try:
        from fido2.hid import CtapHidDevice

        devices.extend(CtapHidDevice.list_devices())
    except Exception as e:  # noqa: BLE001 - platform HID errors vary widely
        log.debug("HID enumeration failed: %s", type(e).__name__)
    if not devices:
        try:
            from fido2.pcsc import CtapPcscDevice

            devices.extend(CtapPcscDevice.list_devices())
        except Exception as e:  # noqa: BLE001 - pyscard missing or no reader
            log.debug("NFC/PC-SC enumeration unavailable: %s", type(e).__name__)
    return devices


def _use_windows_api() -> bool:
    if sys.platform != "win32":
        return False
    try:
        import ctypes

        from fido2.client.windows import WindowsClient

        windll = getattr(ctypes, "windll", None)
        return (
            bool(WindowsClient.is_available()) and windll is not None and not windll.shell32.IsUserAnAdmin()
        )
    except Exception:  # noqa: BLE001
        return False


def _pin_retries(device: Any) -> int | None:
    try:
        from fido2.ctap2.base import Ctap2
        from fido2.ctap2.pin import ClientPin

        retries, _ = ClientPin(Ctap2(device)).get_pin_retries()
        return int(retries)
    except Exception:  # noqa: BLE001
        return None


def _make_client(device: Any, rp_id: str, interaction: Any) -> Any:
    from fido2.client import DefaultClientDataCollector, Fido2Client
    from fido2.ctap2.extensions import HmacSecretExtension

    return Fido2Client(
        device,
        DefaultClientDataCollector(f"https://{rp_id}"),
        user_interaction=interaction,
        extensions=[HmacSecretExtension(allow_hmac_secret=False)],  # type: ignore[no-untyped-call]
    )


def _make_windows_client(rp_id: str) -> Any:
    from fido2.client import DefaultClientDataCollector
    from fido2.client.windows import WindowsClient

    return WindowsClient(DefaultClientDataCollector(f"https://{rp_id}"))


class Fido2PrfSource:
    def __init__(
        self,
        prompter: Prompter,
        *,
        list_devices: Callable[[], list[Any]] = _list_devices,
        make_client: Callable[[Any, str, Any], Any] = _make_client,
        pin_retries: Callable[[Any], int | None] = _pin_retries,
        use_windows_api: Callable[[], bool] = _use_windows_api,
        make_windows_client: Callable[[str], Any] = _make_windows_client,
    ) -> None:
        self.prompter = prompter
        self._list_devices = list_devices
        self._make_client = make_client
        self._pin_retries = pin_retries
        self._use_windows_api = use_windows_api
        self._make_windows_client = make_windows_client

    def _client(self, rp_id: str) -> tuple[Any, Any]:
        if self._use_windows_api():
            return self._make_windows_client(rp_id), None
        devices = self._list_devices()
        if not devices:
            hint = ""
            if sys.platform.startswith("linux"):
                hint = (
                    " On Linux you may need udev rules for FIDO keys "
                    "(see the README section 'Linux: key not detected')."
                )
            raise RecoveryError(
                ExitCode.NO_DEVICE,
                "No security key found. Insert your key (or hold it on the NFC reader)." + hint,
            )
        if len(devices) > 1:
            self.prompter.info(
                "Several keys are connected; using the first one. Unplug the others if this is wrong."
            )
        device = devices[0]
        client = self._make_client(
            device, rp_id, _Interaction(self.prompter, lambda: self._pin_retries(device))
        )
        info = getattr(client, "info", None)
        extensions = getattr(info, "extensions", None) or []
        if "hmac-secret" not in extensions:
            raise RecoveryError(
                ExitCode.UNSUPPORTED_KEY,
                "This key does not support hmac-secret, so it cannot unlock a CryoShield vault "
                "(YubiKey 5 with firmware 5.2 or newer is required).",
            )
        return client, device

    def get(self, rp_id: str, allow: Sequence[bytes] | None) -> list[Assertion]:
        from fido2.client import ClientError
        from fido2.ctap import CtapError

        client, device = self._client(rp_id)
        for attempt in range(1, MAX_PIN_ATTEMPTS + 1):
            self.prompter.info("Touch your security key when it blinks.")
            try:
                return extract(client.get_assertion(request_options(rp_id, allow)))
            except ClientError as e:
                cause = getattr(e, "cause", None)
                code = getattr(cause, "code", None)
                if e.code == ClientError.ERR.DEVICE_INELIGIBLE or code == CtapError.ERR.NO_CREDENTIALS:
                    return []
                if code == CtapError.ERR.PIN_INVALID:
                    left = self._pin_retries(device) if device is not None else None
                    if left == 0 or attempt == MAX_PIN_ATTEMPTS:
                        break
                    self.prompter.info(
                        "Wrong PIN."
                        + (f" {left} attempts left before the key locks." if left is not None else "")
                    )
                    continue
                if code in (CtapError.ERR.PIN_BLOCKED, CtapError.ERR.PIN_AUTH_BLOCKED):
                    raise RecoveryError(
                        ExitCode.PIN_FAILED,
                        "The key's PIN is blocked. Remove and reinsert the key; if it stays blocked, "
                        "the key must be reset, which destroys its credentials. Try another enrolled key.",
                    ) from None
                if code == CtapError.ERR.PIN_NOT_SET or e.code == ClientError.ERR.CONFIGURATION_UNSUPPORTED:
                    raise RecoveryError(
                        ExitCode.UNSUPPORTED_KEY,
                        "This key has no PIN set. CryoShield vaults are bound to PIN-verified use; "
                        "set the same PIN you used when creating the vault and try again.",
                    ) from None
                if e.code == ClientError.ERR.TIMEOUT:
                    raise RecoveryError(
                        ExitCode.CANCELLED, "No touch detected in time. Run the tool again."
                    ) from None
                if (
                    e.code == ClientError.ERR.BAD_REQUEST
                    and cause is not None
                    and "PIN required" in str(cause)
                ):
                    raise RecoveryError(ExitCode.CANCELLED, "Cancelled: no PIN entered.") from None
                raise RecoveryError(
                    ExitCode.INTERNAL,
                    f"The key reported an error ({e.code.name}). Reinsert it and try again.",
                ) from None
        raise RecoveryError(
            ExitCode.PIN_FAILED, "Too many wrong PIN attempts. Run the tool again when ready."
        )

"""Fido2PrfSource with a mocked python-fido2 client (tasks 3.1, 8.1, 8.2). No hardware needed."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

import pytest
from fido2.client import ClientError
from fido2.ctap import CtapError
from fido2.ctap2.extensions import AuthenticatorExtensionsPRFInputs, _prf_salt
from support import vectors
from support.vectors import h

from cryoshield_recover import derive
from cryoshield_recover.authenticator import Fido2PrfSource, extract, request_options
from cryoshield_recover.errors import ExitCode, RecoveryError

AD = {c["name"]: h(c["authenticatorData"]) for c in vectors.cases("authenticatorDataCases")}
CREDS = vectors.cases("vaults")[1]["credentials"]  # A, B, C


def test_python_fido2_prf_salt_mapping_matches_spec() -> None:
    """The library's PRF→hmac-secret mapping equals the vector ctapSalt (task 3.1)."""
    assert _prf_salt(derive.locator_salt()) == derive.ctap_salt()
    assert derive.ctap_salt() == h(vectors.load()["constants"]["ctapSalt"])
    assert derive.ctap_salt() == hashlib.sha256(b"WebAuthn PRF\x00" + derive.locator_salt()).digest()


def test_request_options_shape() -> None:
    o = request_options("cryoshield.app", None)
    assert o.rp_id == "cryoshield.app"
    assert o.user_verification == "required"
    assert o.allow_credentials is None
    prf = AuthenticatorExtensionsPRFInputs.from_dict(o.extensions["prf"])
    assert prf.eval.first == derive.locator_salt() and prf.eval.second is None
    o2 = request_options("x.app", [b"\x01\x02"])
    assert [d.id for d in o2.allow_credentials] == [b"\x01\x02"]


# ------------------------------------------------------------------ fakes
def _resp(prf: bytes | None) -> Any:
    results = SimpleNamespace(first=prf) if prf is not None else None
    return SimpleNamespace(client_extension_results=SimpleNamespace(prf=SimpleNamespace(results=results)))


@dataclass
class FakeSelection:
    items: list[tuple[bytes, bytes, bytes | None]]  # (cred_id, auth_data, prf)

    def get_assertions(self) -> list[Any]:
        return [SimpleNamespace(auth_data=ad, credential={"id": cid}) for cid, ad, _ in self.items]

    def get_response(self, i: int) -> Any:
        return _resp(self.items[i][2])


@dataclass
class FakeClient:
    script: list[Any]  # FakeSelection or Exception, consumed per call
    extensions: list[str] = field(default_factory=lambda: ["credProtect", "hmac-secret"])
    calls: list[Any] = field(default_factory=list)

    @property
    def info(self) -> Any:
        return SimpleNamespace(extensions=self.extensions)

    def get_assertion(self, options: Any) -> Any:
        self.calls.append(options)
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


@dataclass
class Prompter:
    pins: list[str | None] = field(default_factory=lambda: ["123456"])
    messages: list[str] = field(default_factory=list)
    retries_seen: list[int | None] = field(default_factory=list)

    def info(self, msg: str) -> None:
        self.messages.append(msg)

    def ask_pin(self, retries: int | None) -> str | None:
        self.retries_seen.append(retries)
        return self.pins.pop(0) if self.pins else None


def _source(
    client: FakeClient,
    prompter: Prompter | None = None,
    devices: list[Any] | None = None,
    retries: int | None = 7,
) -> Fido2PrfSource:
    return Fido2PrfSource(
        prompter or Prompter(),
        list_devices=lambda: ["dev0"] if devices is None else devices,
        make_client=lambda dev, rp, inter: client,
        pin_retries=lambda dev: retries,
        use_windows_api=lambda: False,
    )


def _sel(*idx: int, ad: str = "uv-set") -> FakeSelection:
    return FakeSelection([(h(CREDS[i]["id"]), AD[ad], h(CREDS[i]["prf"])) for i in idx])


# ------------------------------------------------------------------ behaviour
def test_discoverable_multiple_credentials_one_ceremony() -> None:
    client = FakeClient([_sel(0, 2)])
    got = _source(client).get("cryoshield.app", None)
    assert len(client.calls) == 1 and client.calls[0].allow_credentials is None
    assert [a.cred_id for a in got] == [h(CREDS[0]["id"]), h(CREDS[2]["id"])]
    assert [bytes(a.prf) for a in got] == [h(CREDS[0]["prf"]), h(CREDS[2]["prf"])]
    assert all(isinstance(a.prf, bytearray) for a in got)


def test_allow_list_passed_through() -> None:
    client = FakeClient([_sel(1)])
    _source(client).get("cryoshield.app", [h(CREDS[1]["id"])])
    assert [d.id for d in client.calls[0].allow_credentials] == [h(CREDS[1]["id"])]


def test_no_credentials_returns_empty() -> None:
    err = ClientError(ClientError.ERR.DEVICE_INELIGIBLE, CtapError(CtapError.ERR.NO_CREDENTIALS))
    assert _source(FakeClient([err])).get("cryoshield.app", None) == []


def test_uv_flag_missing_is_rejected() -> None:
    with pytest.raises(RecoveryError) as ei:
        _source(FakeClient([_sel(0, ad="up-only")])).get("cryoshield.app", None)
    assert ei.value.exit_code == ExitCode.UNSUPPORTED_KEY


def test_partial_failure_wipes_earlier_outputs(monkeypatch: pytest.MonkeyPatch) -> None:
    import cryoshield_recover.authenticator as mod

    made: list[Any] = []
    real = mod.Assertion

    def spy(**kw: Any) -> Any:
        a = real(**kw)
        made.append(a)
        return a

    monkeypatch.setattr(mod, "Assertion", spy)
    sel = FakeSelection([(b"a", AD["uv-set"], b"\x11" * 32), (b"b", AD["uv-set"], None)])
    with pytest.raises(RecoveryError):
        extract(sel)
    assert len(made) == 1 and made[0].prf == bytearray(32)


def test_missing_prf_result_is_unsupported() -> None:
    sel = FakeSelection([(b"a", AD["uv-set"], None)])
    with pytest.raises(RecoveryError) as ei:
        extract(sel)
    assert ei.value.exit_code == ExitCode.UNSUPPORTED_KEY


def test_wrong_pin_then_right_pin() -> None:
    bad = ClientError(ClientError.ERR.BAD_REQUEST, CtapError(CtapError.ERR.PIN_INVALID))
    prompter = Prompter()
    client = FakeClient([bad, _sel(0)])
    got = _source(client, prompter, retries=6).get("cryoshield.app", None)
    assert len(got) == 1 and len(client.calls) == 2
    assert any("6 attempts left" in m for m in prompter.messages)


def test_wrong_pin_exhausted() -> None:
    bad = ClientError(ClientError.ERR.BAD_REQUEST, CtapError(CtapError.ERR.PIN_INVALID))
    with pytest.raises(RecoveryError) as ei:
        _source(FakeClient([bad, bad, bad])).get("cryoshield.app", None)
    assert ei.value.exit_code == ExitCode.PIN_FAILED


def test_pin_blocked() -> None:
    err = ClientError(ClientError.ERR.BAD_REQUEST, CtapError(CtapError.ERR.PIN_BLOCKED))
    with pytest.raises(RecoveryError) as ei:
        _source(FakeClient([err])).get("cryoshield.app", None)
    assert ei.value.exit_code == ExitCode.PIN_FAILED
    assert "blocked" in ei.value.message


def test_no_device_message() -> None:
    with pytest.raises(RecoveryError) as ei:
        _source(FakeClient([]), devices=[]).get("cryoshield.app", None)
    assert ei.value.exit_code == ExitCode.NO_DEVICE
    assert "Insert your key" in ei.value.message


def test_no_device_linux_hint(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("sys.platform", "linux")
    with pytest.raises(RecoveryError) as ei:
        _source(FakeClient([]), devices=[]).get("cryoshield.app", None)
    assert "udev" in ei.value.message


def test_key_without_hmac_secret() -> None:
    with pytest.raises(RecoveryError) as ei:
        _source(FakeClient([], extensions=["credProtect"])).get("cryoshield.app", None)
    assert ei.value.exit_code == ExitCode.UNSUPPORTED_KEY
    assert "5.2" in ei.value.message


def test_timeout() -> None:
    err = ClientError(ClientError.ERR.TIMEOUT, CtapError(CtapError.ERR.USER_ACTION_TIMEOUT))
    with pytest.raises(RecoveryError) as ei:
        _source(FakeClient([err])).get("cryoshield.app", None)
    assert ei.value.exit_code == ExitCode.CANCELLED


def test_windows_api_path_used_when_selected() -> None:
    client = FakeClient([_sel(0)])
    src = Fido2PrfSource(
        Prompter(),
        list_devices=lambda: pytest.fail("raw HID must not be used on Windows non-admin"),  # type: ignore[arg-type,return-value]
        make_client=lambda *a: pytest.fail("Fido2Client must not be used"),  # type: ignore[arg-type,return-value]
        use_windows_api=lambda: True,
        make_windows_client=lambda rp: client,
    )
    assert len(src.get("cryoshield.app", None)) == 1

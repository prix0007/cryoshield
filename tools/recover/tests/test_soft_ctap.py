"""Real python-fido2 client against a software CTAP2 authenticator (no hardware).

Proves, through the real PIN protocol and hmac-secret encryption, that the tool sends exactly the
vector ``ctapSalt``, requires UV, handles several discoverable credentials in one ceremony, and
rejects outputs obtained without user verification.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pytest
from support import vectors
from support.keys import BY_NAME
from support.soft_ctap import SoftAuthenticator, SoftCred
from support.vectors import h

from cryoshield_recover.authenticator import Fido2PrfSource
from cryoshield_recover.derive import ctap_salt
from cryoshield_recover.errors import ExitCode, RecoveryError

PIN = "246813"


@dataclass
class Prompter:
    pins: list[str] = field(default_factory=lambda: [PIN])
    messages: list[str] = field(default_factory=list)

    def info(self, msg: str) -> None:
        self.messages.append(msg)

    def ask_pin(self, retries: int | None) -> str | None:
        self.messages.append(f"pin? retries={retries}")
        return self.pins.pop(0) if self.pins else None


def cred(name: str, discoverable: bool = True, rp: str = "cryoshield.app") -> SoftCred:
    return SoftCred(rp, h(BY_NAME[name]["id"]), h(BY_NAME[name]["prf"]), discoverable)


def source(dev: SoftAuthenticator, prompter: Prompter | None = None) -> Fido2PrfSource:
    return Fido2PrfSource(prompter or Prompter(), list_devices=lambda: [dev], use_windows_api=lambda: False)


def test_discoverable_prf_matches_vector_and_salt_is_ctap_salt() -> None:
    dev = SoftAuthenticator([cred("A"), cred("C")], expected_salt=ctap_salt())
    got = source(dev).get("cryoshield.app", None)
    assert [(a.cred_id, bytes(a.prf)) for a in got] == [
        (h(BY_NAME["A"]["id"]), h(BY_NAME["A"]["prf"])),
        (h(BY_NAME["C"]["id"]), h(BY_NAME["C"]["prf"])),
    ]
    assert dev.seen_salts and all(s == ctap_salt() for s in dev.seen_salts)
    assert ctap_salt() == h(vectors.load()["constants"]["ctapSalt"])


def test_allow_list_selects_non_discoverable_credential() -> None:
    dev = SoftAuthenticator([cred("B", discoverable=False)], expected_salt=ctap_salt())
    assert source(dev).get("cryoshield.app", None) == []
    got = source(dev).get("cryoshield.app", [h(BY_NAME["A"]["id"]), h(BY_NAME["B"]["id"])])
    assert [bytes(a.prf) for a in got] == [h(BY_NAME["B"]["prf"])]


def test_other_rp_id_not_returned() -> None:
    dev = SoftAuthenticator([cred("A", rp="example.org")], expected_salt=ctap_salt())
    assert source(dev).get("cryoshield.app", None) == []


def test_wrong_pin_then_right_pin_real_protocol() -> None:
    dev = SoftAuthenticator([cred("A")], expected_salt=ctap_salt())
    p = Prompter(pins=["000000", PIN])
    got = source(dev, p).get("cryoshield.app", None)
    assert bytes(got[0].prf) == h(BY_NAME["A"]["prf"])
    assert any("attempts left" in m for m in p.messages)


def test_pin_blocked_real_protocol() -> None:
    dev = SoftAuthenticator([cred("A")], expected_salt=ctap_salt(), retries=1)
    with pytest.raises(RecoveryError) as ei:
        source(dev, Prompter(pins=["000000"])).get("cryoshield.app", None)
    assert ei.value.exit_code == ExitCode.PIN_FAILED


def test_authenticator_not_reporting_uv_is_rejected() -> None:
    dev = SoftAuthenticator([cred("A")], expected_salt=ctap_salt(), report_uv=False)
    with pytest.raises(RecoveryError) as ei:
        source(dev).get("cryoshield.app", None)
    assert ei.value.exit_code == ExitCode.UNSUPPORTED_KEY


def test_no_pin_entered_cancels() -> None:
    dev = SoftAuthenticator([cred("A")], expected_salt=ctap_salt())
    with pytest.raises(RecoveryError) as ei:
        source(dev, Prompter(pins=[])).get("cryoshield.app", None)
    assert ei.value.exit_code == ExitCode.CANCELLED

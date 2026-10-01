"""Real-hardware checks (opt-in: ``pytest -m hardware``). See docs/manual-yubikey-test.md."""

from __future__ import annotations

import os
from dataclasses import dataclass

import pytest

from cryoshield_recover.authenticator import Fido2PrfSource
from cryoshield_recover.derive import derive_locator
from cryoshield_recover.secure import wipe

pytestmark = pytest.mark.hardware


@dataclass
class TtyPrompter:
    def info(self, msg: str) -> None:
        print(msg)

    def ask_pin(self, retries: int | None) -> str | None:
        import getpass

        return getpass.getpass(f"PIN ({retries} left): ")


def test_locator_matches_browser() -> None:
    """Task 8.3: the real key's PRF output gives the locator the browser derived."""
    expected = os.environ.get("CRYOSHIELD_EXPECTED_LOCATOR")
    rp_id = os.environ.get("CRYOSHIELD_RP_ID", "cryoshield.app")
    if not expected:
        pytest.skip("set CRYOSHIELD_EXPECTED_LOCATOR=0x… (from the web app) to run")
    got = Fido2PrfSource(TtyPrompter()).get(rp_id, None)
    try:
        locators = ["0x" + derive_locator(a.prf).hex() for a in got]
    finally:
        for a in got:
            wipe(a.prf)
    print("derived:", locators)
    assert expected.lower() in locators
    print("PASS")

"""Two vaults on one key against a real EVM (vault-list-labels-archive task 5.3).

A named, archived payload-v2 vault in the real VaultRegistryV2 and an unnamed payload-v1 vault in the
real VaultRegistry (v1), both under key A's locators. Recovered through the real CLI and a software CTAP2
authenticator: interactively (list, then choose), with --list, and non-interactively (exit 12).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import pytest
from support import writer
from support.keys import BY_NAME
from support.vectors import h
from test_anvil_e2e import (
    DEPLOYER,
    OWNER,
    _create_vault_calldata,
    _key,
    _main,
    _send,
    _term,
    anvil,  # noqa: F401 - module-scoped fixture reused here
)
from test_anvil_v2 import HAVE_FOUNDRY, _create_v2_calldata, _deploy, _vault_id_for

from cryoshield_recover import payload
from cryoshield_recover.errors import ExitCode
from cryoshield_recover.format import MODE_ANY_OF_N
from cryoshield_recover.keccak import keccak256
from cryoshield_recover.payload import Item, VaultPayload

pytestmark = [pytest.mark.anvil, pytest.mark.skipif(not HAVE_FOUNDRY, reason="Foundry not installed")]

LOC_A, LOC_B = h(BY_NAME["A"]["locator"]), h(BY_NAME["B"]["locator"])
SALT = keccak256(b"recover-anvil-vault-list")
V1_ID = keccak256(b"recover-anvil-vault-list-v1")
FAMILY = VaultPayload(2, "Family", True, [Item("GitHub codes", "1a2b3-c4d5e"), Item("Email 2FA", "JBSWY3DP")])
WORK = VaultPayload(1, None, False, [Item("Bitcoin seed", "abandon abandon about")])
SECRETS = ["1a2b3-c4d5e", "JBSWY3DP", "abandon abandon about"]


def _blob(vid: bytes, p: VaultPayload) -> bytes:
    creds = [(h(BY_NAME[k]["id"]), bytearray(h(BY_NAME[k]["prf"]))) for k in ("A", "B")]
    return writer.create(
        vault_id=vid,
        rp_id="cryoshield.app",
        credentials=creds,
        secret=payload.write(p),
        mode=MODE_ANY_OF_N,
        threshold=1,
        rng=writer.FixedRng(os.urandom(400)),
    )


@dataclass(frozen=True)
class Two:
    args: list[str]
    v2_id: bytes


@pytest.fixture(scope="module")
def two(anvil: str) -> Two:  # noqa: F811 - pytest fixture injection
    v1, v1_block = _deploy(anvil, "VaultRegistry")
    v2, v2_block = _deploy(anvil, "VaultRegistryV2")
    v2_id = _vault_id_for(anvil, v2, OWNER, SALT)
    assert (
        _send(anvil, OWNER, _create_v2_calldata(SALT, _blob(v2_id, FAMILY), [LOC_A, LOC_B]), v2)["status"]
        == "0x1"
    )
    assert (
        _send(anvil, DEPLOYER, _create_vault_calldata(V1_ID, _blob(V1_ID, WORK), [LOC_A, LOC_B]), v1)[
            "status"
        ]
        == "0x1"
    )
    args = ["--rpc", anvil, "--chain-id", "31337", "--no-arweave", "--registries-only"]
    args += ["--registry", f"{v2}@{v2_block}:v2", "--registry", f"{v1}@{v1_block}:v1"]
    return Two(args, v2_id)


def test_interactive_list_then_choose_the_archived_vault(two: Two) -> None:
    console, out, err = _term("1\nshow\n")
    code = _main(two.args, console, _key("A"))
    assert code == ExitCode.OK, err.getvalue()
    assert "This key opens 2 vaults" in err.getvalue()
    assert '(status: ARCHIVED; vault: "Family")' in out.getvalue()
    assert "GitHub codes: 1a2b3-c4d5e" in out.getvalue() and "Email 2FA: JBSWY3DP" in out.getvalue()
    assert not any(s in err.getvalue() for s in SECRETS)


def test_interactive_choose_the_v1_vault(two: Two) -> None:
    console, out, err = _term("2\nshow\n")
    code = _main(two.args, console, _key("A"))
    assert code == ExitCode.OK, err.getvalue()
    assert (
        "vault: Unnamed vault)" in out.getvalue()
        and "  - Bitcoin seed: abandon abandon about" in out.getvalue()
    )


def test_list(two: Two) -> None:
    console, out, err = _term("", interactive=False)
    code = _main([*two.args, "--list"], console, _key("A"))
    assert code == ExitCode.OK, err.getvalue()
    text = out.getvalue()
    assert f"0x{two.v2_id.hex()}" in text and f"0x{V1_ID.hex()}" in text
    assert "status: ARCHIVED" in text and 'name: "Family"' in text and "name: Unnamed vault" in text
    assert not any(s in text + err.getvalue() for s in [*SECRETS, "GitHub codes", "Bitcoin seed"])


def test_non_interactive_is_ambiguous(two: Two, tmp_path: Path) -> None:
    target = tmp_path / "out.txt"
    console, out, err = _term("", interactive=False)
    code = _main([*two.args, "--output", str(target)], console, _key("A"))
    assert code == ExitCode.AMBIGUOUS
    assert not target.exists()
    assert f"0x{two.v2_id.hex()}" in err.getvalue() and f"0x{V1_ID.hex()}" in err.getvalue()
    assert "Family" not in err.getvalue() and not any(s in err.getvalue() for s in SECRETS)

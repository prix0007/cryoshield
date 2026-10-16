"""The repository README's recovery drill and threat-model notes match the tool (readme-threat-model-and-drill).

The root README documents a ten-minute recovery drill and explains why the tool must present the site's RP ID.
These tests keep that text tied to the code: every ``cryoshield-recover`` command in the README parses with the
real argument parser, the RP ID it names is the tool's built-in one, the library it names is the one in use, and
the app messages it quotes are the app's strings.
"""

from __future__ import annotations

import re
import shlex
from pathlib import Path

import pytest

from cryoshield_recover import cli
from cryoshield_recover.config import DEFAULT_RP_ID, TESTNET

REPO = Path(__file__).resolve().parents[3]
ROOT_README = (REPO / "README.md").read_text(encoding="utf-8")
WEB_STRINGS = REPO / "apps" / "web" / "src" / "ui" / "strings.ts"

VAULT_ID = "0x" + "11" * 32


def _section(heading: str) -> str:
    """The body of the ``## <heading>`` section, up to the next ``##`` heading."""
    m = re.search(rf"^## {re.escape(heading)}\n(.*?)(?=^## |\Z)", ROOT_README, re.S | re.M)
    assert m, f"README has no '## {heading}' section"
    return m.group(1)


def documented_commands() -> list[list[str]]:
    """Every shell line that runs the tool (the command is the first word, with or without ``./``)."""
    cmds = []
    for block in re.findall(r"```sh\n(.*?)```", ROOT_README, re.S):
        for raw in block.splitlines():
            line = raw.split("#")[0].strip()
            m = re.fullmatch(r"(?:\./)?cryoshield-recover(?:-[a-z0-9_-]+)?(\s.*)?", line)
            if m:
                cmds.append(shlex.split(m.group(1) or ""))
    return cmds


def test_drill_has_commands() -> None:
    assert len(documented_commands()) >= 4


@pytest.mark.parametrize("argv", documented_commands(), ids=lambda a: " ".join(a) or "(no args)")
def test_documented_command_parses(argv: list[str], tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """The one placeholder, <vault-id>, is replaced by a valid value; any other placeholder is a failure."""
    monkeypatch.chdir(tmp_path)  # --save-blob and --output refuse an existing file; never touch the repo
    argv = [a.replace("<vault-id>", VAULT_ID) for a in argv]
    assert not [a for a in argv if a.startswith("<")], argv
    args = cli.build_parser().parse_args(argv)
    if "--version" in argv:
        return
    cfg = cli.config_from_args(args)
    if "--testnet" in argv:
        assert cfg.network == TESTNET
    if "--offline" in argv:
        assert cfg.offline and cfg.blob_file is not None and cfg.vault_id == bytes.fromhex(VAULT_ID[2:])
    if "--save-blob" in argv:
        assert cfg.save_blob is not None


def test_status_line_is_current() -> None:
    """The launch happened on 2026-10-12 (v1.0.0); the README must not still call the project testnet-only."""
    lowered = ROOT_README.lower()
    assert "testnet only" not in lowered
    assert "testnet-only" not in lowered
    assert re.search(
        r"^> Status: live on \*\*OP Mainnet\*\* at https://cryoshield\.app since `v1\.0\.0`",
        ROOT_README,
        re.M,
    )


def test_rp_id_binding_is_explained() -> None:
    """The PRF output is bound to the RP ID; the tool presents it with python-fido2 and never contacts the site."""
    body = _section("What CryoShield depends on")
    assert "python-fido2" in body
    assert "hmac-secret" in body
    assert f"`{DEFAULT_RP_ID}`" in body
    assert "--rp-id" in body
    assert "RP ID" in body
    # The claim that matters: no DNS, TLS or website is involved in presenting the RP ID.
    assert re.search(
        r"never (contacts|talks to|connects to) (the website|cryoshield\.app|`cryoshield\.app`)", body
    )
    # The order the tool really uses (recover.py _rp_id_order): the configured RP ID first, then the vaults'.
    assert "tries the configured RP ID first" in body
    assert "which wins" not in body


def _web_string(key: str) -> str:
    m = re.search(rf"^\s+{key}: '([^']+)',?$", WEB_STRINGS.read_text(encoding="utf-8"), re.M)
    assert m, f"{key} not found in {WEB_STRINGS}"
    return m.group(1)


def test_sponsored_gas_is_a_listed_caveat() -> None:
    """Sponsorship is the one single-company dependency: writes stop, reads and recovery survive."""
    body = _section("What CryoShield depends on")
    assert "Pimlico" in body
    # The quoted messages are the app's own strings (sponsored-vault-writes "Cap reached").
    assert _web_string("paused") in body
    assert _web_string("pausedCreate") in body
    assert re.search(r"writes? stop", body, re.I)
    assert "never falls back to an unsponsored" in body


def test_recovery_drill_blocks_the_site_and_ends_with_show() -> None:
    body = _section("Recovery drill")
    assert "ten minutes" in body.lower()
    assert "hosts" in body
    assert "127.0.0.1 cryoshield.app" in body and "::1       cryoshield.app" in body
    assert "`show`" in body
    assert "--testnet" in body
    assert "--rp-id cryoshield-web-dev.fly.dev" in body  # the development site has its own RP ID
    assert "--offline" in body and "--save-blob" in body
    assert "gh attestation verify" in body  # authenticity, not only integrity
    # Readers are told to drill with a throwaway vault, since the secret appears on screen.
    assert re.search(r"test vault|throwaway|dummy", body, re.I)
    # The steps are numbered and the site is blocked before the tool runs and before the secret is shown.
    assert body.index("127.0.0.1 cryoshield.app") < body.index("`show`")

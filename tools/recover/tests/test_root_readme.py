"""The repository README's recovery drill and threat-model notes match the tool (readme-threat-model-and-drill).

The root README documents a ten-minute recovery drill and explains why the tool must present the site's RP ID.
These tests keep that text tied to the code: every ``cryoshield-recover`` command in the README parses with the
real argument parser, the RP ID it names is the tool's built-in one, and the library it names is the one in use.
"""

from __future__ import annotations

import re
import shlex
from pathlib import Path

import pytest

from cryoshield_recover import cli
from cryoshield_recover.config import DEFAULT_RP_ID, TESTNET
from cryoshield_recover.errors import ExitCode, RecoveryError

ROOT_README = Path(__file__).resolve().parents[3] / "README.md"


def _section(text: str, heading: str) -> str:
    """The body of the ``## <heading>`` section, up to the next ``##`` heading."""
    m = re.search(rf"^## {re.escape(heading)}\n(.*?)(?=^## |\Z)", text, re.S | re.M)
    assert m, f"README has no '## {heading}' section"
    return m.group(1)


def documented_commands() -> list[list[str]]:
    cmds = []
    for block in re.findall(r"```sh\n(.*?)```", ROOT_README.read_text(), re.S):
        for line in block.splitlines():
            line = "" if line.lstrip().startswith("#") else line.split("#")[0].strip()
            m = re.search(r"(?:^|\s)(?:\./)?cryoshield-recover(?:-[a-z0-9_-]+)?(\s.*)?$", line)
            if m and not any(w in line for w in ("uvx", "pipx", "curl", "chmod")):
                cmds.append(shlex.split(m.group(1) or ""))
    return cmds


def test_drill_has_commands() -> None:
    assert len(documented_commands()) >= 4


@pytest.mark.parametrize("argv", documented_commands(), ids=lambda a: " ".join(a) or "(no args)")
def test_documented_command_parses(argv: list[str]) -> None:
    """Placeholders like <vault-id> are replaced by valid values before parsing."""
    argv = [re.sub(r"<vault-id>", "0x" + "11" * 32, a) for a in argv]
    argv = [a for a in argv if not a.startswith("<")]
    args = cli.build_parser().parse_args(argv)
    if argv and argv[0] in ("--help", "--version"):
        return
    try:
        cli.config_from_args(args)
    except RecoveryError as e:  # --offline needs the blob file to exist
        assert e.exit_code in (ExitCode.OUTPUT_REFUSED, ExitCode.USAGE), e


def test_status_line_is_current() -> None:
    """The launch happened on 2026-10-12 (v1.0.0); the README must not still call the project testnet-only."""
    text = ROOT_README.read_text()
    assert "testnet only" not in text.lower()
    assert "testnet-only" not in text.lower()
    assert "https://cryoshield.app" in text
    assert "OP Mainnet" in text


def test_rp_id_binding_is_explained() -> None:
    """The PRF output is bound to the RP ID; the tool presents it with python-fido2 and never contacts the site."""
    text = ROOT_README.read_text()
    body = _section(text, "What CryoShield depends on")
    assert "python-fido2" in body
    assert "hmac-secret" in body
    assert f"`{DEFAULT_RP_ID}`" in body
    assert "--rp-id" in body
    assert "RP ID" in body
    # The claim that matters: no DNS, TLS or website is involved in presenting the RP ID.
    assert re.search(
        r"never (contacts|talks to|connects to) (the website|cryoshield\.app|`cryoshield\.app`)", body
    )


def test_sponsored_gas_is_a_listed_caveat() -> None:
    """Sponsorship is the one single-company dependency: writes stop, reads and recovery survive."""
    body = _section(ROOT_README.read_text(), "What CryoShield depends on")
    assert "Pimlico" in body
    assert "Saving is paused" in body  # the app's message, sponsored-vault-writes "Cap reached"
    assert re.search(r"writes? stop", body, re.I)
    assert "unsponsored" in body or "never charges you" in body or "never falls back" in body


def test_recovery_drill_blocks_the_site_and_ends_with_show() -> None:
    body = _section(ROOT_README.read_text(), "Recovery drill")
    assert "ten minutes" in body.lower()
    assert "hosts" in body and "127.0.0.1 cryoshield.app" in body
    assert "`show`" in body
    assert f"--{TESTNET.split('-')[1]}" in body or "--testnet" in body
    assert "--offline" in body and "--save-blob" in body
    # Readers are told to drill with a throwaway vault, since the secret appears on screen.
    assert re.search(r"test vault|throwaway|dummy", body, re.I)
    # The steps are numbered and the site is blocked before the tool runs.
    assert body.index("127.0.0.1 cryoshield.app") < body.index("`show`")

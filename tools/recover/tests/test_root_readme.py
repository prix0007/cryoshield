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

from cryoshield_recover import cli, derive, recover
from cryoshield_recover.config import DEFAULT_RP_ID, TESTNET

REPO = Path(__file__).resolve().parents[3]
ROOT_README_PATH = REPO / "README.md"
WEB_STRINGS = REPO / "apps" / "web" / "src" / "ui" / "strings.ts"
TOOL_README = REPO / "tools" / "recover" / "README.md"

VAULT_ID = "0x" + "11" * 32


def _readme() -> str:
    """Read lazily, so collection does not fail in a partial checkout (only these tests do)."""
    assert ROOT_README_PATH.is_file(), f"{ROOT_README_PATH} missing: run from a full checkout"
    return ROOT_README_PATH.read_text(encoding="utf-8")


def _section(heading: str) -> str:
    """The body of the ``## <heading>`` section, up to the next ``##`` heading."""
    m = re.search(rf"^## {re.escape(heading)}\n(.*?)(?=^## |\Z)", _readme(), re.S | re.M)
    assert m, f"README has no '## {heading}' section"
    return m.group(1)


def documented_commands() -> list[list[str]]:
    """Every shell line that runs the tool (the command is the first word, with or without ``./``)."""
    cmds = []
    if not ROOT_README_PATH.is_file():  # parametrize runs at collection; test_drill_has_commands reports it
        return []
    for block in re.findall(r"```(?:sh|bash|shell)\n(.*?)```", _readme(), re.S):
        for raw in block.splitlines():
            line = " ".join(shlex.split(raw, comments=True))
            m = re.fullmatch(r"(?:\./)?cryoshield-recover(?:-[a-z0-9_-]+)?(\s.*)?", line)
            if m:
                cmds.append(shlex.split(m.group(1) or ""))
    return cmds


def test_drill_has_commands() -> None:
    assert len(documented_commands()) >= 5


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
        if "--rp-id" not in argv:
            assert cfg.rp_id == DEFAULT_RP_ID  # "--testnet only picks the chain"
    if "--rp-id" in argv:
        assert cfg.rp_id == argv[argv.index("--rp-id") + 1] != DEFAULT_RP_ID
    if "--offline" in argv:
        assert cfg.offline and cfg.blob_file is not None and cfg.vault_id == bytes.fromhex(VAULT_ID[2:])
    if "--save-blob" in argv:
        assert cfg.save_blob is not None


def test_status_line_is_current() -> None:
    """The launch happened on 2026-10-12 (v1.0.0); the README must not still call the project testnet-only."""
    text = _readme()
    lowered = text.lower()
    assert "testnet only" not in lowered
    assert "testnet-only" not in lowered
    assert re.search(
        r"^> Status: live on \*\*OP Mainnet\*\* at https://cryoshield\.app since `v1\.0\.0`",
        text,
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
    assert "tries the configured RP ID first when any copy it found records it" in body
    assert "which wins" not in body


def test_salt_mapping_has_its_own_line() -> None:
    """A CTAP2 client must hash the PRF input as browsers do (vault-format-v1 §3); the README states the formula."""
    body = _section("What CryoShield depends on")
    assert 'SHA-256("WebAuthn PRF" || 0x00 ||' in body
    assert f'SHA-256("{derive.LOCATOR_SALT_INPUT.decode()}")' in body
    assert "docs/spec/vault-format-v1.md#3-single-prf-input-and-ctap-salt-mapping" in body
    assert "derive.py" in body
    assert "test-vectors" in body


def _paragraph(lead: str) -> str:
    """The one-line README paragraph that starts with ``**<lead>**``."""
    m = re.search(rf"^\*\*{re.escape(lead)}\*\*.*$", _section("What CryoShield depends on"), re.M)
    assert m, f"README has no paragraph starting with '{lead}'"
    return m.group(0)


def _quoted_first_sentence(message: str) -> str:
    """The message's first sentence as the README quotes it: in double quotes, with its period."""
    first, sep, _ = message.partition(". ")
    assert sep, message
    return f'"{first}."'


def test_wrong_rp_id_is_a_named_failure() -> None:
    """A wrong RP ID never looks like a bad key: the README explains each path with the tool's own messages."""
    body = _paragraph("A wrong RP ID does not look like a bad key.")
    prefix, sep, _ = recover.NO_DISCOVERABLE_CREDENTIAL.partition(" '{rp_id}'")
    assert sep, recover.NO_DISCOVERABLE_CREDENTIAL
    assert f'"{prefix}"' in body
    assert "--rp-id" in recover.NO_DISCOVERABLE_CREDENTIAL and "`--rp-id`" in body
    assert _quoted_first_sentence(recover.NOT_LISTED) in body
    assert _quoted_first_sentence(recover.DID_NOT_UNLOCK) in body
    assert "--vault-id" in recover.DID_NOT_UNLOCK and "`--vault-id`" in body
    assert "--rp-id" not in recover.DID_NOT_UNLOCK  # the one input that is never the cause on that path
    assert "AES-256-GCM" in body  # the per-credential wrap tag is the key check
    assert "Shamir" in body  # a Shamir vault wraps a 33-byte share, not the data key
    assert "never a name someone else gives you" in body
    # The two header-derived lines are quoted from the tool in both READMEs, and the reader is told that the
    # first is printed before the key is asked (so cancel there) and the second after it has answered.
    tool_readme = TOOL_README.read_text(encoding="utf-8")
    for constant, lead in (
        (recover.OTHER_SITE_COPY, "was created for the site"),
        (recover.NO_CREDENTIAL_FOR_SITE, "no credential for"),
    ):
        phrase, sep, _ = constant.partition(" '{rp_id}'")
        assert sep, constant
        assert phrase.endswith(lead), constant
        assert f'"{lead}"' in body
        assert f'"{lead}"' in tool_readme
    for text in (body, tool_readme):
        assert "before the key is asked" in text
        assert "Ctrl-C" in text
        assert "Windows" in text
        assert "after the key has answered" in text


def _web_string(key: str) -> str:
    """The value of ``key: '…'`` or ``key: "…"`` in strings.ts, across a line break, with escapes removed."""
    assert WEB_STRINGS.is_file(), f"{WEB_STRINGS} missing: run from a full checkout"
    source = WEB_STRINGS.read_text(encoding="utf-8")
    m = re.search(rf"^\s+{key}:\s*(['\"])((?:[^\\]|\\.)*?)\1,?$", source, re.M | re.S)
    assert m, f"{key} not found in {WEB_STRINGS}"
    return re.sub(r"\\(.)", r"\1", m.group(2))


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
    assert "127.0.0.1 cryoshield.app" in body and re.search(r"^\s*::1\s+cryoshield\.app", body, re.M)
    assert "`show`" in body
    assert "--testnet" in body
    assert "--rp-id cryoshield-web-dev.fly.dev" in body  # the development site has its own RP ID
    assert "--offline" in body and "--save-blob" in body
    assert "gh attestation verify" in body  # authenticity, not only integrity
    # Readers are told to drill with a throwaway vault, since the secret appears on screen.
    assert re.search(r"test vault|throwaway|dummy", body, re.I)
    # The steps are numbered and the site is blocked before the tool runs and before the secret is shown.
    assert body.index("127.0.0.1 cryoshield.app") < body.index("**Type `show`.**")

"""Every command documented in the README parses with the real argument parser (task 10.1)."""

from __future__ import annotations

import re
import shlex
from pathlib import Path

import pytest

from cryoshield_recover import cli
from cryoshield_recover.errors import ExitCode

README = Path(__file__).resolve().parents[1] / "README.md"


def documented_commands() -> list[list[str]]:
    text = README.read_text()
    cmds = []
    for block in re.findall(r"```sh\n(.*?)```", text, re.S):
        for line in block.splitlines():
            line = line.split("#")[0].strip() if not line.lstrip().startswith("#") else ""
            m = re.search(r"(?:^|\s)cryoshield-recover(\s.*)?$", line)
            if m and "uvx" not in line and "pipx" not in line:
                cmds.append(shlex.split(m.group(1) or ""))
    return cmds


def test_readme_has_commands() -> None:
    assert len(documented_commands()) >= 8


@pytest.mark.parametrize("argv", documented_commands(), ids=lambda a: " ".join(a) or "(no args)")
def test_documented_command_parses(argv: list[str]) -> None:
    args = cli.build_parser().parse_args(argv)
    if argv and argv[0] in ("--help", "--version"):
        return
    try:
        cli.config_from_args(args)
    except Exception as e:  # pragma: no cover - surfaced as a test failure
        from cryoshield_recover.errors import RecoveryError

        assert isinstance(e, RecoveryError) and e.exit_code == ExitCode.OUTPUT_REFUSED, e


def test_readme_exit_codes_match() -> None:
    text = README.read_text()
    for code in ExitCode:
        assert re.search(rf"^\| {code.value} \|", text, re.M), f"exit code {code.value} undocumented"


def test_readme_documents_the_mainnet_default() -> None:
    """launch-op-mainnet 3.4: mainnet is the default, testnet vaults need --testnet, mainnet is v2-only."""
    from cryoshield_recover.config import DEFAULT_NETWORK, TESTNET

    text = README.read_text()
    assert f"| `{DEFAULT_NETWORK}` (**default**) |" in text
    assert f"| `{TESTNET}` (`--testnet`) |" in text
    assert f"the built-in default, `{DEFAULT_NETWORK}`" in text
    assert "testnet preview" in text
    assert "OP Mainnet has only VaultRegistry v2" in text
    assert "OP Sepolia by default" not in text and "not decided yet" not in text
    # 6.1 review M1: the README ships from main before the launch, so it never says mainnet is live now.
    assert "runs on OP Mainnet" not in text
    assert "From the OP Mainnet launch" in text


def test_readme_git_installs_are_pinned_to_a_release_tag() -> None:
    """6.1 review M1: an unpinned git install would run whatever is on main; pin to a release tag."""
    text = README.read_text()
    urls = re.findall(r"git\+https://[^\s\"']+", text)
    assert urls, "the README documents a source install"
    for url in urls:
        # A concrete release tag (vX.Y.Z) or the <release-tag> placeholder; never a branch or no ref.
        m = re.fullmatch(
            r"git\+https://github\.com/prix0007/cryoshield@(<release-tag>|v\d+\.\d+\.\d+)"
            r"#subdirectory=tools/recover",
            url,
        )
        assert m, url
        if m.group(1) == "<release-tag>":
            assert "replace `<release-tag>`" in text.lower()

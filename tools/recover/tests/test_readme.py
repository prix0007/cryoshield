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

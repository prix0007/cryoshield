from __future__ import annotations

import subprocess
import sys

import pytest

from cryoshield_recover import __version__
from cryoshield_recover.cli import main


def test_version_flag(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["--version"]) == 0
    out = capsys.readouterr().out
    assert __version__ in out
    assert "format v1" in out


def test_console_script_entry() -> None:
    proc = subprocess.run(
        [sys.executable, "-m", "cryoshield_recover", "--version"], capture_output=True, text=True, check=False
    )
    assert proc.returncode == 0
    assert "format v1" in proc.stdout

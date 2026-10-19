"""The tool's version is the CryoShield release it ships with (release-recovery-tool-assets, design D8)."""

from __future__ import annotations

import re
from pathlib import Path

from cryoshield_recover import __version__

ROOT = Path(__file__).resolve().parents[1]


def _project_version() -> str:
    # tomllib needs Python 3.11; CI also tests 3.10, so read the one line instead.
    m = re.search(r'^\[project\][^\[]*?^version = "([^"]+)"', (ROOT / "pyproject.toml").read_text(), re.M | re.S)
    assert m, "pyproject.toml has no [project] version"
    return m.group(1)


def test_package_version_matches_pyproject() -> None:
    assert __version__ == _project_version()


def test_version_is_plain_semver() -> None:
    # recover-release.yml compares it with the release tag vX.Y.Z (no local or build suffixes).
    assert re.fullmatch(r"\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?", __version__)


def test_lockfile_records_the_same_version() -> None:
    lock = (ROOT / "uv.lock").read_text()
    own = re.findall(r'^name = "cryoshield-recover"\nversion = "([^"]+)"', lock, re.M)
    assert own == [__version__]


def test_release_version_is_1_0_3() -> None:
    # The tool version is the release it ships with (design D8); bump it before every release. v1.0.3 is next.
    assert __version__ == "1.0.3"

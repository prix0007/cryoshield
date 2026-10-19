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


def test_readme_install_lines_name_the_version() -> None:
    # The README's pinned install lines (pipx wheel URL, uvx tag, the "files on release" sentence) move with every
    # release (design D8), so they must name the current version and nothing older.
    readme = (ROOT / "README.md").read_text()
    assert f"releases/download/v{__version__}/cryoshield_recover-{__version__}-py3-none-any.whl" in readme
    assert f"cryoshield@v{__version__}#subdirectory=tools/recover" in readme
    assert f"release `v{__version__}` print `cryoshield-recover {__version__}`" in readme
    stale = {m for m in re.findall(r"cryoshield_recover-(\d+\.\d+\.\d+)|cryoshield@v(\d+\.\d+\.\d+)", readme) for m in m if m}
    assert stale == {__version__}

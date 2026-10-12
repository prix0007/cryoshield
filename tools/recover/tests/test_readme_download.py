"""The README's install and download instructions match what a release carries (release-recovery-tool-assets 5.1)."""

from __future__ import annotations

import re
from pathlib import Path

README = (Path(__file__).resolve().parents[1] / "README.md").read_text()
LATEST = "https://github.com/prix0007/cryoshield/releases/latest/download/"
# The same fixed names as BINARIES in .github/scripts/recover-release.mjs (that script's tests check this list too).
BINARIES = [
    "cryoshield-recover-linux-arm64",
    "cryoshield-recover-linux-x86_64",
    "cryoshield-recover-macos-arm64",
    "cryoshield-recover-macos-x86_64",
    "cryoshield-recover-windows-x86_64.exe",
]


def test_every_binary_has_a_stable_download_link() -> None:
    for name in BINARIES:
        assert f"{LATEST}{name}" in README, name


def test_no_package_index_install_is_promised() -> None:
    # cryoshield-recover is not on PyPI: no bare `uvx cryoshield-recover` / `pipx install cryoshield-recover[...]`.
    assert not re.search(r"uvx\s+cryoshield-recover\b", README)
    assert not re.search(r"pipx install \"?cryoshield-recover(\[|\"|\s|$)", README, re.M)
    assert "not on PyPI" in README


def test_verification_is_documented() -> None:
    assert "SHA256SUMS" in README
    assert "shasum -a 256 -c" in README
    assert "gh attestation verify" in README
    assert "--repo prix0007/cryoshield" in README


def test_unsigned_binaries_are_disclosed() -> None:
    assert "not code-signed" in README
    assert "SmartScreen" in README
    assert "com.apple.quarantine" in README

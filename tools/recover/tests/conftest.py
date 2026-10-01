from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

_OPT_IN = {"hardware", "network", "release"}


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption("--run-hardware", action="store_true", help="run tests that need a real FIDO2 key")
    parser.addoption("--run-network", action="store_true", help="run tests that use public endpoints")
    parser.addoption("--run-release", action="store_true", help="run release-build checks")


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    markexpr = config.getoption("-m") or ""
    for item in items:
        for name in _OPT_IN:
            if name in item.keywords and name not in markexpr and not config.getoption(f"--run-{name}"):
                item.add_marker(pytest.mark.skip(reason=f"opt-in: run with -m {name}"))

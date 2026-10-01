"""Opt-in markers exist and are skipped by default (task 1.2)."""

from __future__ import annotations

import pytest


@pytest.mark.hardware
def test_hardware_marker_is_opt_in() -> None:  # pragma: no cover - only runs with -m hardware
    assert True


@pytest.mark.network
def test_network_marker_is_opt_in() -> None:  # pragma: no cover
    assert True


def test_markers_registered(pytestconfig: pytest.Config) -> None:
    names = {m.split(":")[0] for m in pytestconfig.getini("markers")}
    assert {"hardware", "network", "anvil", "release"} <= names

"""Adaptive eth_getLogs paging against RPCs with block-range limits (live finding: drpc HTTP 400)."""

from __future__ import annotations

import pytest
from support import vectors
from support.fakes import TEST_CHAIN_ID, FakeChain
from support.keys import BY_NAME
from support.vectors import h

from cryoshield_recover import chain as chain_mod
from cryoshield_recover.chain import Registry

V2 = vectors.cases("vaults")[0]
VID = h(V2["vaultId"])
BLOB2 = h(vectors.cases("updatePayloadCases")[0]["expectedBlob"])
LOCS = [h(BY_NAME["A"]["locator"]), h(BY_NAME["B"]["locator"])]


def _chain() -> FakeChain:
    c = FakeChain()
    c.block = 20_000
    c.add_vault(VID, h(V2["blob"]), LOCS)
    c.update_vault(VID, BLOB2)
    return c


def test_default_page_is_10k() -> None:
    assert chain_mod.DEFAULT_LOG_CHUNK == 10_000
    with _chain() as c:
        c.max_log_range = 10**9  # unlimited, but record the widths
        assert Registry([c.url], c.address, TEST_CHAIN_ID).event_hashes(VID) is not None
    assert c.log_ranges == [10_000, 10_000, 1]  # blocks 0..20000


@pytest.mark.parametrize("mode", ["http400", "-32005", "-32600"])
def test_range_limited_rpc_halves_page_and_succeeds(mode: str) -> None:
    with _chain() as limited, _chain() as normal:
        limited.max_log_range, limited.range_error_mode = 3_000, mode
        reg = Registry([limited.url, normal.url], normal.address, TEST_CHAIN_ID)
        hashes = reg.event_hashes(VID)
    assert hashes is not None and [v for v, _ in hashes] == [1, 2]  # both RPCs answered and agree
    assert any(w > 3_000 for w in limited.log_ranges)  # was rejected first...
    accepted = [w for w in limited.log_ranges if w <= 3_000]
    assert accepted and max(accepted) == 2_500  # ...then halved 10000 -> 5000 -> 2500


def test_range_below_floor_is_a_failure() -> None:
    with _chain() as tiny:
        tiny.max_log_range = chain_mod.MIN_LOG_CHUNK - 1
        reg = Registry([tiny.url], tiny.address, TEST_CHAIN_ID)
        assert reg.event_hashes(VID) is None
    assert min(tiny.log_ranges) == chain_mod.MIN_LOG_CHUNK  # halved down to the floor, then gave up
    assert any("event history unavailable" in w for w in reg.warnings)


def test_non_range_error_is_not_retried() -> None:
    with _chain() as broken:
        broken.logs_error = True  # generic failure, not a range limit
        broken_calls_before = len(broken.requests)
        reg = Registry([broken.url], broken.address, TEST_CHAIN_ID)
        assert reg.event_hashes(VID) is None
        get_logs = [r for r in broken.requests[broken_calls_before:] if b"eth_getLogs" in r.body]
    assert len(get_logs) == 1


def test_range_errors_classified() -> None:
    from cryoshield_recover.rpc import RpcError

    assert chain_mod.is_range_error(RpcError("x", http_status=400))
    assert chain_mod.is_range_error(RpcError("x", code=-32005))
    assert chain_mod.is_range_error(RpcError("block range too large", code=-32600))
    assert not chain_mod.is_range_error(RpcError("x", code=-32600))  # -32600 alone is generic
    assert not chain_mod.is_range_error(RpcError("execution reverted", code=-32000))
    assert not chain_mod.is_range_error(RpcError("x", http_status=500))


def test_floor_low_enough_for_drpc_free_plan() -> None:
    """Live finding 2026-10-02: drpc's free plan accepts only ~100-block eth_getLogs ranges."""
    with _chain() as drpc_like, _chain() as normal:
        drpc_like.block = 400
        normal.block = 400
        drpc_like.max_log_range = 100
        reg = Registry([drpc_like.url, normal.url], normal.address, TEST_CHAIN_ID)
        assert reg.event_hashes(VID) is not None
    assert max(w for w in drpc_like.log_ranges if w <= 100) == 78  # 10000 halved to 78 (> floor 64)


def test_hopeless_paging_fails_fast() -> None:
    """If a tiny accepted range would need more pages than the budget, give up at once (no stall)."""
    with _chain() as tiny:
        tiny.block = 5_000_000
        tiny.max_log_range = 100
        reg = Registry([tiny.url], tiny.address, TEST_CHAIN_ID, max_log_pages=1_000)
        assert reg.event_hashes(VID) is None
    assert len(tiny.log_ranges) <= 10
    assert any("history unavailable" in w for w in reg.warnings)

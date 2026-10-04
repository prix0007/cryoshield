"""Regression tests for the ECC review of PR #22 (harden-recovery-network-trust)."""

from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass
from typing import Any

import pytest
from support.fakes import FakeArweave, FakeChain
from support.keys import FakePrfSource, PhysicalKey
from support.vectors import h
from test_network_trust import (
    KEY,
    LOC,
    NEW,
    NEW_SECRET,
    OLD,
    OLD_SECRET,
    UI,
    VID,
    Client,
    honest_logs,
)
from test_recover import cfg_for

from cryoshield_recover import arweave as arw
from cryoshield_recover import chain as chain_mod
from cryoshield_recover.arweave import Arweave
from cryoshield_recover.candidates import Freshness
from cryoshield_recover.chain import Registry, normalize_url
from cryoshield_recover.config import Config
from cryoshield_recover.errors import ExitCode, RecoveryError
from cryoshield_recover.net import TooLarge
from cryoshield_recover.recover import Recovery

REG = "0x" + "11" * 20
CHAIN = 11155420
LOCS = [LOC]


# ------------------------------------------------------------------ HIGH 1: truncated agreed history
def test_low_head_rpc_cannot_truncate_agreed_history() -> None:
    """2 RPCs: the lagging/lying one serves OLD and reports a head between the create and the update.
    Paging both only to the lower head would make OLD "verified". It must be unverifiable instead."""
    with FakeChain() as lagger, FakeChain() as honest:
        for c in (lagger, honest):
            c.add_vault(VID, OLD, LOCS)  # VaultCreated at block 10
        honest.update_vault(VID, NEW)  # VaultUpdated at block 11 (on the honest node only)
        lagger.update_vault(VID, NEW)
        owner, _, _ = lagger.vaults[VID]
        lagger.vaults[VID] = (owner, OLD, 1)  # stale state...
        lagger.block = 10  # ...and a head before the update (within HEAD_TOLERANCE of 1000)
        honest.block = 1000
        cfg = cfg_for(honest)
        cfg.rpcs = [lagger.url, honest.url]
        ui = UI(choice=None)
        prf = FakePrfSource([PhysicalKey.named(KEY)])
        rec = Recovery(cfg, prf, ui)
        try:
            res = rec.run()
        except RecoveryError as e:
            assert e.exit_code == ExitCode.AMBIGUOUS  # a forced choice is fine; a false "current" is not
            return
    assert not (res.candidate.blob == OLD and res.candidate.freshness is Freshness.CURRENT)
    assert res.candidate.blob == NEW or res.candidate.freshness is not Freshness.CURRENT


def test_history_pages_to_highest_accepted_head() -> None:
    a = Client("https://a.example", NEW, 2, honest_logs(), latest=50_000_000)
    b = Client("https://b.example", NEW, 2, honest_logs(), latest=50_000_400)
    seen: list[int] = []

    class Spy(Client):
        def call(self, method: str, params: list[Any], timeout: float | None = None) -> Any:
            if method == "eth_getLogs":
                seen.append(int(params[0]["toBlock"], 16))
            return super().call(method, params, timeout)

    spy_a = Spy(**{**a.__dict__})
    spy_b = Spy(**{**b.__dict__})
    by = {"https://a.example": spy_a, "https://b.example": spy_b}
    reg = Registry(list(by), REG, CHAIN, 49_999_000, client_factory=lambda u: by[u])  # type: ignore[arg-type,return-value]
    reg.event_hashes(VID)
    assert seen and max(seen) == 50_000_400


# ------------------------------------------------------------------ HIGH 2: slow first GraphQL server
class SlowArweave(FakeArweave):
    """Answers every GraphQL page slowly with hasNextPage=true and never the genuine tx."""

    delay = 0.6

    def handle(self, method: str, path: str, body: bytes) -> tuple[int, dict[str, str], bytes]:
        if path == "/graphql":
            time.sleep(self.delay)
            return (
                200,
                {"Content-Type": "application/json"},
                json.dumps(
                    {
                        "data": {
                            "transactions": {
                                "pageInfo": {"hasNextPage": True},
                                "edges": [{"cursor": f"x{time.time_ns()}", "node": {}}],
                            }
                        }
                    }
                ).encode(),
            )
        return super().handle(method, path, body)


def test_slow_first_graphql_server_cannot_starve_honest_one(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(arw, "ARWEAVE_SERVER_DEADLINE", 2.0)
    with SlowArweave() as slow, FakeArweave() as honest:
        tid = honest.mirror(NEW, vault_id=VID, locators=LOCS)
        a = Arweave([slow.graphql_url, honest.graphql_url], [honest.url], timeout=10)
        t0 = time.monotonic()
        txs = a.find_by_locator(LOC)
        elapsed = time.monotonic() - t0
    assert tid in {t.id for t in txs}
    assert elapsed < 4.0  # servers in parallel, each within its own budget


def test_request_timeout_clamped_to_remaining_budget(monkeypatch: pytest.MonkeyPatch) -> None:
    timeouts: list[float] = []

    def fake_post(url: str, payload: Any, *, timeout: float, max_bytes: int) -> Any:
        timeouts.append(timeout)
        return {"data": {"transactions": {"pageInfo": {"hasNextPage": False}, "edges": []}}}

    monkeypatch.setattr(arw, "post_json", fake_post)
    monkeypatch.setattr(arw, "ARWEAVE_SERVER_DEADLINE", 3.0)
    Arweave(["https://g.example/graphql"], ["https://gw.example"], timeout=100).find_by_locator(LOC)
    assert timeouts and all(0 < t <= 3.0 for t in timeouts)


def test_oldest_page_fetched_first(monkeypatch: pytest.MonkeyPatch) -> None:
    sorts: list[str] = []

    def fake_post(url: str, payload: Any, *, timeout: float, max_bytes: int) -> Any:
        sorts.append(payload["variables"]["sort"])
        return {"data": {"transactions": {"pageInfo": {"hasNextPage": False}, "edges": []}}}

    monkeypatch.setattr(arw, "post_json", fake_post)
    Arweave(["https://g.example/graphql"], ["https://gw.example"]).find_by_locator(LOC)
    assert sorts[0] == "HEIGHT_ASC"


def test_page_budget_exhaustion_warns(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_post(url: str, payload: Any, *, timeout: float, max_bytes: int) -> Any:
        after = payload["variables"].get("after") or "0"
        return {
            "data": {
                "transactions": {
                    "pageInfo": {"hasNextPage": True},
                    "edges": [{"cursor": str(int(after) + 1), "node": {}}],
                }
            }
        }

    monkeypatch.setattr(arw, "post_json", fake_post)
    a = Arweave(["https://g.example/graphql"], ["https://gw.example"])
    a.find_by_locator(LOC)
    assert any("newer" in w and "g.example" in w for w in a.warnings)


# ------------------------------------------------------------------ MEDIUM: Arweave rank by one server
def _two_servers_old_and_new(withhold_new: bool, inflate_old: bool) -> list[Any]:
    def node(tid: str, vid: bytes, height: int) -> dict[str, Any]:
        tags = [
            {"name": "App-Name", "value": "CryoShield"},
            {"name": "CryoShield-Vault-Id", "value": "0x" + vid.hex()},
            {"name": "CryoShield-Locator", "value": "0x" + LOC.hex()},
        ]
        return {
            "cursor": tid,
            "node": {"id": tid, "data": {"size": "1"}, "block": {"height": height}, "tags": tags},
        }

    old_id, new_id = "O" * 43, "N" * 43
    honest = [node(new_id, VID, 20), node(old_id, VID, 10)]
    hostile = [node(old_id, VID, 10**14 if inflate_old else 10)] + (
        [] if withhold_new else [node(new_id, VID, 20)]
    )
    return [honest, hostile, {old_id: OLD, new_id: NEW}]


@pytest.mark.parametrize(("withhold", "inflate"), [(True, False), (False, True)], ids=["withhold", "inflate"])
def test_one_graphql_server_cannot_pick_the_older_copy(
    monkeypatch: pytest.MonkeyPatch, withhold: bool, inflate: bool
) -> None:
    honest, hostile, data = _two_servers_old_and_new(withhold, inflate)
    answers = {"https://honest.example/graphql": honest, "https://hostile.example/graphql": hostile}

    def fake_post(url: str, payload: Any, **kw: Any) -> Any:
        return {"data": {"transactions": {"pageInfo": {"hasNextPage": False}, "edges": answers[url]}}}

    monkeypatch.setattr(arw, "post_json", fake_post)
    monkeypatch.setattr(arw, "get_capped", lambda url, **kw: data[url.rsplit("/", 1)[1]])
    cfg = Config(
        rpcs=[],
        registry="0x" + "00" * 20,
        use_chain=False,
        arweave_graphql=list(answers),
        arweave_gateways=["https://gw.example"],
    )
    ui = UI(choice=None)
    with pytest.raises(RecoveryError) as ei:  # unverified Arweave rivals: the user must choose
        Recovery(cfg, FakePrfSource([PhysicalKey.named(KEY)]), ui).run()
    assert ei.value.exit_code == ExitCode.AMBIGUOUS
    assert ui.asked and len(ui.asked[0]) == 2


def test_arweave_height_is_minimum_claimed(monkeypatch: pytest.MonkeyPatch) -> None:
    honest, hostile, data = _two_servers_old_and_new(False, True)
    answers = {"https://honest.example/graphql": honest, "https://hostile.example/graphql": hostile}
    monkeypatch.setattr(
        arw,
        "post_json",
        lambda url, payload, **kw: {
            "data": {"transactions": {"pageInfo": {"hasNextPage": False}, "edges": answers[url]}}
        },
    )
    monkeypatch.setattr(arw, "get_capped", lambda url, **kw: data[url.rsplit("/", 1)[1]])
    cfg = Config(
        rpcs=[],
        registry="0x" + "00" * 20,
        use_chain=False,
        arweave_graphql=list(answers),
        arweave_gateways=["https://gw.example"],
    )
    rec = Recovery(cfg, FakePrfSource([PhysicalKey.named(KEY)]), UI())
    cands = rec._arweave_by_locators([LOC])
    old = next(c for c in cands if c.blob == OLD)
    assert old.height == 10


# ------------------------------------------------------------------ MEDIUM: download budget
def test_downloads_have_a_count_budget(monkeypatch: pytest.MonkeyPatch) -> None:
    fetched: list[str] = []
    edges = [
        {
            "cursor": str(i),
            "node": {
                "id": f"{i:043d}",
                "data": {"size": "1"},
                "block": {"height": i},
                "tags": [
                    {"name": "App-Name", "value": "CryoShield"},
                    {"name": "CryoShield-Vault-Id", "value": "0x" + VID.hex()},
                    {"name": "CryoShield-Locator", "value": "0x" + LOC.hex()},
                ],
            },
        }
        for i in range(1, 51)
    ]
    monkeypatch.setattr(
        arw,
        "post_json",
        lambda url, payload, **kw: {
            "data": {"transactions": {"pageInfo": {"hasNextPage": False}, "edges": edges}}
        },
    )

    def get(url: str, **kw: Any) -> bytes:
        fetched.append(url)
        return b"junk"

    monkeypatch.setattr(arw, "get_capped", get)
    monkeypatch.setattr(arw, "MAX_FETCHES", 7)
    cfg = Config(
        rpcs=[],
        registry="0x" + "00" * 20,
        use_chain=False,
        arweave_graphql=["https://g.example/graphql"],
        arweave_gateways=["https://gw.example"],
    )
    rec = Recovery(cfg, FakePrfSource([PhysicalKey.named(KEY)]), UI())
    rec._arweave_by_locators([LOC])
    assert len(fetched) == 7
    assert any("download budget" in w for w in rec.warnings())


# ------------------------------------------------------------------ MEDIUM: one history deadline per run
def test_history_deadline_is_per_registry_run(monkeypatch: pytest.MonkeyPatch) -> None:
    class Clock:
        now = 0.0

        def monotonic(self) -> float:
            return self.now

    clock = Clock()
    monkeypatch.setattr(chain_mod, "time", clock)
    c = Client("https://a.example", NEW, 2, [], latest=10)
    reg = Registry(["https://a.example"], REG, CHAIN, 0, client_factory=lambda u: c)  # type: ignore[arg-type,return-value]
    assert reg.event_hashes(b"\x01" * 32) is not None
    clock.now = chain_mod.HISTORY_DEADLINE + 1  # the run's budget is spent
    assert reg.event_hashes(b"\x02" * 32) is None
    assert any("deadline" in w for w in reg.warnings)


def test_rpc_timeout_clamped_to_remaining_history_budget(monkeypatch: pytest.MonkeyPatch) -> None:
    timeouts: list[float | None] = []

    class T(Client):
        def call(self, method: str, params: list[Any], timeout: float | None = None) -> Any:
            if method in ("eth_getLogs", "eth_blockNumber"):
                timeouts.append(timeout)
            return super().call(method, params, timeout)

    c = T("https://a.example", NEW, 2, [], latest=10)
    reg = Registry(["https://a.example"], REG, CHAIN, 0, client_factory=lambda u: c)  # type: ignore[arg-type,return-value]
    reg.event_hashes(VID)
    assert timeouts and all(t is not None and 0 < t <= chain_mod.HISTORY_DEADLINE for t in timeouts)


# ------------------------------------------------------------------ LOW: URL keys
@pytest.mark.parametrize(
    ("a", "b"),
    [
        ("https://h.example", "https://h.example:443/"),
        ("https://H.example./rpc", "https://h.example/rpc"),
        ("http://127.0.0.1:80/x", "http://127.0.0.1/x"),
    ],
)
def test_normalize_url_equivalences(a: str, b: str) -> None:
    assert normalize_url(a) == normalize_url(b)


def test_two_paths_on_one_host_are_two_sources() -> None:
    assert normalize_url("https://h.example/a") != normalize_url("https://h.example/b")
    c1 = Client("https://h.example/a", NEW, 2, honest_logs())
    c2 = Client("https://h.example/b", NEW, 2, honest_logs())
    c1.url, c2.url = "https://h.example/a", "https://h.example/b"  # type: ignore[attr-defined]
    c1.host = c2.host = "h.example"
    by = {"https://h.example/a": c1, "https://h.example/b": c2}
    reg = Registry(list(by), REG, CHAIN, 0, client_factory=lambda u: by[u])  # type: ignore[arg-type,return-value]
    cands = reg.fetch([VID])
    assert cands[0].support == 2


# ------------------------------------------------------------------ LOW: secret wiped when the tie prompt aborts
def test_secret_wiped_when_tie_prompt_aborts(monkeypatch: pytest.MonkeyPatch) -> None:
    import cryoshield_recover.recover as mod

    made: list[bytearray] = []
    real = mod.open_decoded

    def spy(*a: Any, **k: Any) -> bytearray:
        out = real(*a, **k)
        made.append(out)
        return out

    monkeypatch.setattr(mod, "open_decoded", spy)
    clients = {
        "https://a.example": Client("https://a.example", NEW, 2, honest_logs()),
        "https://b.example": Client("https://b.example", OLD, 7, honest_logs()[:1]),
    }
    cfg = Config(rpcs=list(clients), registry=REG, chain_id=CHAIN, deploy_block=0, use_arweave=False)
    reg = lambda cfg: Registry(cfg.rpcs, cfg.registry, cfg.chain_id, 0, client_factory=lambda u: clients[u])  # type: ignore[arg-type,return-value]  # noqa: E731
    with pytest.raises(RecoveryError):
        Recovery(cfg, FakePrfSource([PhysicalKey.named(KEY)]), UI(choice=None), registry_factory=reg).run()
    assert made and all(b == bytearray(len(b)) for b in made)


# ------------------------------------------------------------------ LOW: gateway fallback
def test_fetch_falls_back_to_next_gateway(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    def get(url: str, **kw: Any) -> bytes:
        calls.append(url)
        if url.startswith("https://big.example"):
            raise TooLarge("too big")
        if url.startswith("https://empty.example"):
            return b""
        return NEW

    monkeypatch.setattr(arw, "get_capped", get)
    a = Arweave(
        ["https://g.example/graphql"], ["https://big.example", "https://empty.example", "https://ok.example"]
    )
    tx = arw.ArweaveTx(
        id="A" * 43, size=None, height=1, vault_id=VID, version=None, locators=[LOC], server="g"
    )
    assert a.fetch(tx) == NEW
    assert len(calls) == 3


_ = (threading, dataclass, h, NEW_SECRET, OLD_SECRET)

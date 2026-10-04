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


def test_history_pages_each_rpc_to_its_own_head() -> None:
    """Security review M1 (verified live 2026-10-04): op-geth/publicnode reject toBlock beyond their own
    head (-32602 'block range extends beyond current head block'). Each RPC pages to its OWN head; a low
    head only shortens its own history, which then disagrees (never a shortened *agreed* history)."""
    seen: dict[str, int] = {}

    class HeadStrict(Client):
        def call(self, method: str, params: list[Any], timeout: float | None = None) -> Any:
            if method == "eth_getLogs":
                to = int(params[0]["toBlock"], 16)
                if to > self.latest:
                    from cryoshield_recover.rpc import RpcError

                    raise RpcError(
                        f"{self.host}: block range extends beyond current head block: requested {to}",
                        code=-32602,
                    )
                seen[self.host] = max(seen.get(self.host, 0), to)
            return super().call(method, params, timeout)

    a = HeadStrict("https://a.example", NEW, 2, honest_logs(), latest=50_000_000)
    b = HeadStrict("https://b.example", NEW, 2, honest_logs(), latest=50_000_003)  # normal small lag
    by = {"https://a.example": a, "https://b.example": b}
    reg = Registry(list(by), REG, CHAIN, 49_999_000, client_factory=lambda u: by[u])  # type: ignore[arg-type,return-value]
    hashes = reg.event_hashes(VID)
    assert hashes is not None and [v for v, _ in hashes] == [1, 2]  # agreed despite different heads
    assert seen == {"https://a.example": 50_000_000, "https://b.example": 50_000_003}


def test_beyond_head_error_is_not_a_range_limit() -> None:
    from cryoshield_recover.rpc import RpcError

    e = RpcError("x: block range extends beyond current head block: requested 5", code=-32602)
    assert not chain_mod.is_range_error(e)


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


# ================================================================== security review (task 8.1) round 1
SH = next(v for v in __import__("support.vectors", fromlist=["cases"]).cases("vaults") if v["mode"] == 2)
SH_UPD = next(
    c
    for c in __import__("support.vectors", fromlist=["cases"]).cases("updatePayloadCases")
    if c["vault"] == SH["name"] and "expectedBlob" in c
)


def test_shamir_vault_tie_requires_explicit_choice() -> None:
    """H1: threshold vaults must go through the same tie logic (no silent pick by RPC order)."""
    from support.vectors import h as hx
    from test_recover import RecUI

    from cryoshield_recover.keccak import keccak256

    sh_vid = hx(SH_UPD["vaultId"])
    sh_old, sh_new = hx(SH_UPD["blob"]), hx(SH_UPD["expectedBlob"])

    def lg(topic: bytes, ver: int, blob: bytes, blk: int) -> dict[str, Any]:
        return {
            "address": REG,
            "topics": ["0x" + topic.hex(), "0x" + sh_vid.hex()],
            "data": "0x" + ver.to_bytes(32, "big").hex() + keccak256(blob).hex(),
            "blockNumber": hex(blk),
        }

    from cryoshield_recover import abi

    logs = [lg(abi.TOPIC_VAULT_CREATED, 1, sh_old, 5), lg(abi.TOPIC_VAULT_UPDATED, 2, sh_new, 9)]

    class ShClient(Client):
        def call(self, method: str, params: list[Any], timeout: float | None = None) -> Any:
            if method == "eth_call":
                from support.fakes import enc_bytes32_array, enc_vault

                data = bytes.fromhex(params[0]["data"][2:])
                if data[:4] == abi.SEL_RESOLVE_LOCATOR:
                    return "0x" + enc_bytes32_array([sh_vid]).hex()
                return "0x" + enc_vault("0x" + "22" * 20, self.blob, self.version).hex()
            return super().call(method, params, timeout)

    clients = {
        "https://liar.example": ShClient("https://liar.example", sh_old, 9, logs[:1]),
        "https://honest.example": ShClient("https://honest.example", sh_new, 2, logs),
    }
    cfg = Config(rpcs=list(clients), registry=REG, chain_id=CHAIN, deploy_block=0, use_arweave=False)

    def reg(cfg: Config) -> Registry:
        return Registry(cfg.rpcs, cfg.registry, cfg.chain_id, 0, client_factory=lambda u: clients[u])  # type: ignore[arg-type,return-value]

    keys = [PhysicalKey.named("A"), PhysicalKey.named("C")]
    ui = RecUI(pick=lambda opts: next(i for i, o in enumerate(opts) if "honest.example" in o))
    res = Recovery(cfg, FakePrfSource(keys, ui=ui), ui, registry_factory=reg).run()
    assert ui.choices, "Shamir tie was decided silently"
    assert bytes(res.secret) == hx(SH_UPD["newSecret"])
    ui2 = RecUI(pick=None)
    with pytest.raises(RecoveryError) as ei:
        Recovery(cfg, FakePrfSource(keys, ui=ui2), ui2, registry_factory=reg).run()
    assert ei.value.exit_code == ExitCode.AMBIGUOUS


def _arweave_cfg(ar: FakeArweave, chain: FakeChain) -> Config:
    return cfg_for(chain, ar)


def test_genuine_mirror_recovered_despite_download_spam() -> None:
    """H2 end to end: genuine mirror + 45 newer spam txs under the locator, chain down."""
    from test_recover import RecUI

    with FakeChain() as chain, FakeArweave() as ar:
        chain.down = True
        ar.mirror(NEW, vault_id=VID, locators=LOCS, height=10)
        for i in range(45):
            ar.mirror(b"spam%d" % i, vault_id=VID, locators=LOCS, height=1_000 + i)
        ui = RecUI(pick=lambda opts: 0)
        res = Recovery(_arweave_cfg(ar, chain), FakePrfSource([PhysicalKey.named(KEY)], ui=ui), ui).run()
    assert bytes(res.secret) == NEW_SECRET


def test_replayed_old_mirror_never_silently_shown() -> None:
    """H2: genuine current mirror (oldest) + spam + a replayed OLDER genuine blob as the newest tx."""
    from test_recover import RecUI

    with FakeChain() as chain, FakeArweave() as ar:
        chain.down = True
        ar.mirror(NEW, vault_id=VID, locators=LOCS, height=10)
        for i in range(45):
            ar.mirror(b"spam%d" % i, vault_id=VID, locators=LOCS, height=1_000 + i)
        ar.mirror(OLD, vault_id=VID, locators=LOCS, height=9_999)
        ui = RecUI(pick=None)
        with pytest.raises(RecoveryError) as ei:
            Recovery(_arweave_cfg(ar, chain), FakePrfSource([PhysicalKey.named(KEY)], ui=ui), ui).run()
    assert ei.value.exit_code == ExitCode.AMBIGUOUS
    assert ui.choices


def test_truncated_arweave_search_needs_confirmation_when_unverified() -> None:
    """H2 (2): budget cut short + unverified copy: never presented as unambiguous."""
    from test_recover import RecUI

    with FakeChain() as chain, FakeArweave() as ar:
        chain.down = True
        ar.mirror(NEW, vault_id=VID, locators=LOCS, height=10)
        for i in range(45):
            ar.mirror(b"spam%d" % i, vault_id=VID, locators=LOCS, height=1_000 + i)
        ui = RecUI(pick=None)  # non-interactive
        with pytest.raises(RecoveryError) as ei:
            Recovery(_arweave_cfg(ar, chain), FakePrfSource([PhysicalKey.named(KEY)], ui=ui), ui).run()
    assert ei.value.exit_code == ExitCode.AMBIGUOUS
    assert ui.choices and any("cut short" in o for o in ui.choices[0])


def test_fetch_reclamps_timeout_per_gateway(monkeypatch: pytest.MonkeyPatch) -> None:
    """L1: the per-request timeout is recomputed for each gateway."""

    class Clock:
        now = 0.0

        def monotonic(self) -> float:
            return self.now

    clock = Clock()
    monkeypatch.setattr(arw, "time", clock)
    timeouts: list[float] = []

    def get(url: str, *, timeout: float, max_bytes: int) -> bytes:
        timeouts.append(timeout)
        clock.now += 5.0
        raise TooLarge("x")

    monkeypatch.setattr(arw, "get_capped", get)
    a = Arweave(["https://g.example/graphql"], ["https://a.example", "https://b.example"], timeout=100)
    tx = arw.ArweaveTx(
        id="A" * 43, size=None, height=1, vault_id=VID, version=None, locators=[LOC], server="g"
    )
    a.fetch(tx, deadline=8.0)
    assert timeouts == [8.0, 3.0]


def test_cached_records_still_counted_after_budget(monkeypatch: pytest.MonkeyPatch) -> None:
    """L2: hitting the download budget must not drop later records of already-downloaded tx ids."""
    monkeypatch.setattr(arw, "MAX_FETCHES", 1)
    monkeypatch.setattr(arw, "get_capped", lambda url, **kw: b"data-" + url[-3:].encode())
    a = Arweave(["https://g.example/graphql"], ["https://gw.example"])

    def rec(tid: str, server: str) -> Any:
        return arw.ArweaveTx(
            id=tid, size=None, height=1, vault_id=VID, version=None, locators=[LOC], server=server
        )

    x, y, z = "X" * 43, "Y" * 43, "Z" * 43
    out = a.fetch_all([rec(x, "s1"), rec(z, "s1"), rec(y, "s2"), rec(x, "s2")])
    assert [(t.id, t.server) for t, _ in out] == [(x, "s1"), (x, "s2")]


def test_state_reads_share_a_run_deadline(monkeypatch: pytest.MonkeyPatch) -> None:
    """L3: resolveLocator/getVault loops are bounded by a run deadline with clamped timeouts."""

    class Clock:
        now = 0.0

        def monotonic(self) -> float:
            return self.now

    clock = Clock()
    monkeypatch.setattr(chain_mod, "time", clock)
    calls: list[float | None] = []

    class Slow(Client):
        def call(self, method: str, params: list[Any], timeout: float | None = None) -> Any:
            if method == "eth_call":
                calls.append(timeout)
                clock.now += 25.0
            return super().call(method, params, timeout)

    c = Slow("https://a.example", NEW, 2, [])
    reg = Registry(["https://a.example"], REG, CHAIN, 0, client_factory=lambda u: c)  # type: ignore[arg-type,return-value]
    reg.resolve([bytes([i]) * 32 for i in range(1, 11)])
    assert len(calls) <= 3
    assert all(t is not None and t <= chain_mod.STATE_DEADLINE for t in calls)
    assert any("deadline" in w for w in reg.warnings)

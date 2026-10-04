"""Regression tests for the 2026-10 security audit (docs/reviews/security-audit-2026-10.md).

REC-M1, REC-M2 and REC-L1 were PROVED by proof_net.py; each proof is reproduced here and must stay green.
OpenSpec change: harden-recovery-network-trust.
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field
from typing import Any

import pytest
from support import vectors
from support.fakes import FakeArweave, enc_bytes32_array, enc_vault
from support.keys import FakePrfSource, PhysicalKey
from support.vectors import h

from cryoshield_recover import abi, cli
from cryoshield_recover import arweave as arw
from cryoshield_recover.arweave import Arweave
from cryoshield_recover.candidates import Freshness
from cryoshield_recover.chain import Registry
from cryoshield_recover.config import Config
from cryoshield_recover.derive import derive_locator
from cryoshield_recover.errors import ExitCode, RecoveryError
from cryoshield_recover.keccak import keccak256
from cryoshield_recover.recover import Recovery
from cryoshield_recover.rpc import RpcError
from cryoshield_recover.ui import Console

UPD = next(c for c in vectors.cases("updatePayloadCases") if "expectedBlob" in c)
VID = h(UPD["vaultId"])
OLD, NEW = h(UPD["blob"]), h(UPD["expectedBlob"])
VAULT = next(v for v in vectors.cases("vaults") if v["name"] == UPD["vault"])
KEY = VAULT["keys"][0]
LOC = derive_locator(h(VAULT["credentials"][0]["prf"]))
OLD_SECRET = h(VAULT["secret"])
NEW_SECRET = h(UPD["newSecret"])
REG = "0x" + "11" * 20
CHAIN = 11155420


def _log(topic: bytes, ver: int, blob: bytes, blk: int) -> dict[str, Any]:
    return {
        "address": REG,
        "topics": ["0x" + topic.hex(), "0x" + VID.hex()],
        "data": "0x" + ver.to_bytes(32, "big").hex() + keccak256(blob).hex(),
        "blockNumber": hex(blk),
    }


def honest_logs() -> list[dict[str, Any]]:
    return [_log(abi.TOPIC_VAULT_CREATED, 1, OLD, 5), _log(abi.TOPIC_VAULT_UPDATED, 2, NEW, 9)]


@dataclass
class Client:
    """In-process RPC stand-in (the audit's proof harness)."""

    host: str
    blob: bytes
    version: int
    logs: list[dict[str, Any]]
    fail: bool = False
    latest: int = 10
    n_getlogs: int = 0
    max_bytes: int = 65536

    def call(self, method: str, params: list[Any], timeout: float | None = None) -> Any:
        if self.fail and method != "eth_chainId":
            raise RpcError(f"{self.host} unreachable")
        if method == "eth_chainId":
            return hex(CHAIN)
        if method == "eth_blockNumber":
            return hex(self.latest)
        if method == "eth_call":
            data = bytes.fromhex(params[0]["data"][2:])
            if data[:4] == abi.SEL_RESOLVE_LOCATOR:
                return "0x" + enc_bytes32_array([VID]).hex()
            return "0x" + enc_vault("0x" + "22" * 20, self.blob, self.version).hex()
        if method == "eth_getLogs":
            self.n_getlogs += 1
            return self.logs
        raise AssertionError(method)


@dataclass
class UI:
    lines: list[str] = field(default_factory=list)
    choice: int | None = None
    asked: list[list[str]] = field(default_factory=list)

    def info(self, m: str) -> None:
        self.lines.append(m)

    def warn(self, m: str) -> None:
        self.lines.append("WARN " + m)

    def pause(self, m: str) -> None:
        raise AssertionError("pause")

    def choose(self, prompt: str, options: list[str]) -> int:
        self.asked.append(options)
        if self.choice is None:
            raise RecoveryError(ExitCode.AMBIGUOUS, "ambiguous")
        return self.choice


def run(clients: list[Client], ui: UI | None = None) -> tuple[Any, UI]:
    cfg = Config(
        rpcs=[c.host for c in clients], registry=REG, chain_id=CHAIN, deploy_block=0, use_arweave=False
    )
    by = {c.host: c for c in clients}

    def reg_factory(cfg: Config) -> Registry:
        return Registry(cfg.rpcs, cfg.registry, cfg.chain_id, 0, client_factory=lambda u: by[u])  # type: ignore[arg-type,return-value]

    ui = ui or UI()
    res = Recovery(cfg, FakePrfSource([PhysicalKey.named(KEY)]), ui, registry_factory=reg_factory).run()
    return res, ui


# ------------------------------------------------------------------ REC-M1
def test_rec_m1_variant_a_inflated_version_and_truncated_logs() -> None:
    res, _ = run(
        [
            Client("https://honest1.example", NEW, 2, honest_logs()),
            Client("https://honest2.example", NEW, 2, honest_logs()),
            Client("https://liar.example", OLD, 2**32 - 1, honest_logs()[:1]),
        ]
    )
    assert res.candidate.blob == NEW, "one liar of three rolled the vault back"
    assert bytes(res.secret) == NEW_SECRET
    assert any("disagree" in w for w in res.warnings)


def test_rec_m1_variant_b_liar_sole_answer_is_not_current() -> None:
    res, _ = run(
        [
            Client("https://honest1.example", NEW, 2, honest_logs(), fail=True),
            Client("https://honest2.example", NEW, 2, honest_logs(), fail=True),
            Client("https://liar.example", OLD, 1, []),
        ]
    )
    assert res.candidate.freshness is not Freshness.CURRENT
    assert res.candidate.freshness is Freshness.UNVERIFIABLE


def test_quorum_met_is_current() -> None:
    res, _ = run(
        [
            Client("https://a.example", NEW, 2, honest_logs()),
            Client("https://b.example", NEW, 2, honest_logs()),
            Client("https://c.example", NEW, 2, honest_logs(), fail=True),
        ]
    )
    assert res.candidate.freshness is Freshness.CURRENT and res.candidate.support == 2


def test_duplicate_urls_count_once() -> None:
    c = Client("https://node.example/rpc", OLD, 1, [])
    by = {"https://node.example/rpc": c, "https://NODE.example/rpc/": c}
    reg = Registry(list(by), REG, CHAIN, 0, client_factory=lambda u: by[u])  # type: ignore[arg-type,return-value]
    assert len(reg.usable()) == 1
    cands = reg.fetch([VID])
    assert len(cands) == 1 and cands[0].support == 1
    assert cands[0].freshness is Freshness.CURRENT  # 1 distinct configured RPC: quorum min(2, 1) = 1


def test_two_rpcs_tie_requires_explicit_choice() -> None:
    clients = [
        Client("https://a.example", NEW, 2, honest_logs()),
        Client("https://b.example", OLD, 7, honest_logs()[:1]),
    ]
    ui = UI(choice=None)
    with pytest.raises(RecoveryError) as ei:
        run(clients, ui)
    assert ei.value.exit_code == ExitCode.AMBIGUOUS
    assert ui.asked and len(ui.asked[0]) == 2
    text = " ".join(ui.asked[0])
    assert "a.example" in text and "b.example" in text and "unverified" in text
    assert NEW_SECRET.decode() not in text and OLD_SECRET.decode()[:20] not in text
    for choice, expected in ((0, None), (1, None)):
        ui = UI(choice=choice)
        res, ui = run(clients, ui)
        chosen_label = ui.asked[0][choice]
        expected = NEW_SECRET if "a.example" in chosen_label else OLD_SECRET
        assert bytes(res.secret) == expected


def test_tie_non_interactive_exits_12_and_writes_nothing(tmp_path: Any) -> None:
    clients = {
        "https://a.example": Client("https://a.example", NEW, 2, honest_logs()),
        "https://b.example": Client("https://b.example", OLD, 7, honest_logs()[:1]),
    }

    def reg_factory(cfg: Config) -> Registry:
        return Registry(cfg.rpcs, cfg.registry, cfg.chain_id, 0, client_factory=lambda u: clients[u])  # type: ignore[arg-type,return-value]

    out = tmp_path / "secret.txt"
    err = io.StringIO()
    console = Console(io.StringIO(""), io.StringIO(), err, getpass_fn=lambda _p: "1", interactive=False)
    code = cli.main(
        [
            "--rpc",
            "https://a.example",
            "--rpc",
            "https://b.example",
            "--registry",
            REG,
            "--no-arweave",
            "--deploy-block",
            "0",
            "--output",
            str(out),
        ],
        console=console,
        prf_factory=lambda ui: FakePrfSource([PhysicalKey.named(KEY)], ui=ui),
        registry_factory=reg_factory,
    )
    assert code == ExitCode.AMBIGUOUS == 12
    assert not out.exists()


# ------------------------------------------------------------------ REC-L1
def test_rec_l1_hostile_head_sole_rpc_fails_fast() -> None:
    liar = Client("https://liar.example", OLD, 1, [], latest=10**9)
    reg = Registry(["https://liar.example"], REG, CHAIN, 0, client_factory=lambda u: liar)  # type: ignore[arg-type,return-value]
    assert reg.event_hashes(VID) is None
    assert liar.n_getlogs == 0


def test_rec_l1_hostile_head_refused_against_median() -> None:
    honest = [Client(f"https://h{i}.example", NEW, 2, honest_logs(), latest=50_000_000) for i in range(2)]
    liar = Client("https://liar.example", NEW, 2, honest_logs(), latest=10**9)
    by = {c.host: c for c in [*honest, liar]}
    reg = Registry(list(by), REG, CHAIN, 49_990_000, client_factory=lambda u: by[u])  # type: ignore[arg-type,return-value]
    hashes = reg.event_hashes(VID)
    assert hashes is not None and [v for v, _ in hashes] == [1, 2]
    assert liar.n_getlogs == 0
    assert any("implausible" in w and "liar.example" in w for w in reg.warnings)


def test_rec_l1_history_deadline(monkeypatch: pytest.MonkeyPatch) -> None:
    from cryoshield_recover import chain as chain_mod

    class Clock:
        now = 0.0

        def monotonic(self) -> float:
            return self.now

    clock = Clock()
    monkeypatch.setattr(chain_mod, "time", clock)

    class SlowClient(Client):
        def call(self, method: str, params: list[Any], timeout: float | None = None) -> Any:
            if method == "eth_getLogs":
                clock.now += 25.0  # each page takes 25 s of (fake) time
            return super().call(method, params, timeout)

    slow = SlowClient("https://slow.example", NEW, 2, [], latest=200_000)
    reg = Registry(["https://slow.example"], REG, CHAIN, 0, client_factory=lambda u: slow)  # type: ignore[arg-type,return-value]
    assert reg.event_hashes(VID) is None
    assert slow.n_getlogs == 3  # pages at t=0, 25, 50; the deadline (60 s) stops the 4th
    assert any("deadline" in w for w in reg.warnings)


# ------------------------------------------------------------------ REC-M2
GEN_ID = "A" * 43


def _node(size: int, vid_hex: str, locs: list[bytes]) -> dict[str, Any]:
    tags = [{"name": "App-Name", "value": "CryoShield"}, {"name": "CryoShield-Vault-Id", "value": vid_hex}]
    tags += [{"name": "CryoShield-Locator", "value": "0x" + loc.hex()} for loc in locs]
    return {
        "data": {
            "transactions": {
                "pageInfo": {"hasNextPage": False},
                "edges": [
                    {
                        "cursor": "1",
                        "node": {
                            "id": GEN_ID,
                            "data": {"size": str(size)},
                            "block": {"height": 7},
                            "tags": tags,
                        },
                    }
                ],
            }
        }
    }


@pytest.mark.parametrize("order", ["honest-first", "hostile-first"])
def test_rec_m2_size_zero_claim_cannot_hide_mirror(monkeypatch: pytest.MonkeyPatch, order: str) -> None:
    answers = {
        "https://honest.example/graphql": _node(len(NEW), "0x" + VID.hex(), [LOC]),
        "https://hostile.example/graphql": _node(0, "0x" + VID.hex(), [LOC]),
    }
    monkeypatch.setattr(arw, "post_json", lambda url, payload, **kw: answers[url])
    monkeypatch.setattr(arw, "get_capped", lambda url, **kw: NEW)
    urls = list(answers) if order == "honest-first" else list(reversed(answers))
    a = Arweave(urls, ["https://gw.example"])
    blobs = [a.fetch(t) for t in a.find_by_locator(LOC)]
    assert NEW in blobs


def test_rec_m2_relabel_cannot_replace_genuine_vault_id(monkeypatch: pytest.MonkeyPatch) -> None:
    answers = {
        "https://honest.example/graphql": _node(len(NEW), "0x" + VID.hex(), [LOC]),
        "https://hostile.example/graphql": _node(1, "0x" + "ee" * 32, [LOC]),
    }
    monkeypatch.setattr(arw, "post_json", lambda url, payload, **kw: answers[url])
    a = Arweave(list(answers), ["https://gw.example"])
    txs = a.find_by_locator(LOC)
    assert VID in {t.vault_id for t in txs}
    assert {t.server for t in txs} == {"honest.example", "hostile.example"}


def test_rec_m2_buried_original_still_found() -> None:
    with FakeArweave() as ar:
        genuine = ar.mirror(NEW, vault_id=VID, locators=[LOC], height=10)
        for i in range(120):  # 120 newer spam transactions under the victim's locator
            ar.mirror(b"spam%d" % i, vault_id=VID, locators=[LOC], height=1_000 + i)
        a = Arweave([ar.graphql_url], [ar.url], timeout=5)
        ids = {t.id for t in a.find_by_locator(LOC)}
    assert genuine in ids


def test_rec_m2_paging_is_bounded() -> None:
    with FakeArweave() as ar:
        for i in range(2_000):
            ar.mirror(b"spam%d" % i, vault_id=VID, locators=[LOC], height=1_000 + i)
        Arweave([ar.graphql_url], [ar.url], timeout=5).find_by_locator(LOC)
        assert ar.graphql_pages <= arw.ARWEAVE_MAX_PAGES + 1


def test_rec_m2_recovery_via_honest_server_despite_hostile_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    """End to end: chain down, one hostile GraphQL server claims size 0 for the genuine mirror."""
    answers = {
        "https://hostile.example/graphql": _node(0, "0x" + VID.hex(), [LOC]),
        "https://honest.example/graphql": _node(len(NEW), "0x" + VID.hex(), [LOC]),
    }
    monkeypatch.setattr(arw, "post_json", lambda url, payload, **kw: answers[url])
    monkeypatch.setattr(arw, "get_capped", lambda url, **kw: NEW)
    cfg = Config(
        rpcs=[],
        registry="0x" + "00" * 20,
        use_chain=False,
        arweave_graphql=list(answers),
        arweave_gateways=["https://gw.example"],
    )
    res = Recovery(cfg, FakePrfSource([PhysicalKey.named(KEY)]), UI()).run()
    assert bytes(res.secret) == NEW_SECRET


# ------------------------------------------------------------------ INFO: --timeout
@pytest.mark.parametrize("value", ["inf", "nan", "-inf", "0", "-1", "301"])
def test_timeout_must_be_finite_and_bounded(value: str) -> None:
    err = io.StringIO()
    console = Console(io.StringIO(""), io.StringIO(), err, getpass_fn=lambda _p: "1", interactive=True)
    with pytest.raises(SystemExit) as ei:
        cli.main(["--timeout", value], console=console)
    assert ei.value.code == ExitCode.USAGE

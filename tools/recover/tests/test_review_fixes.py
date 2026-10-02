"""Regression tests for the security review of add-desktop-recovery-tool (findings 1–5, 7)."""

from __future__ import annotations

import io
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import pytest
from support import vectors, writer
from support.fakes import TEST_CHAIN_ID, FakeArweave, FakeChain
from support.keys import BY_NAME, FakePrfSource, PhysicalKey
from support.vectors import h
from test_recover import RecUI, cfg_for

from cryoshield_recover import cli, net
from cryoshield_recover.arweave import Arweave
from cryoshield_recover.candidates import Freshness
from cryoshield_recover.chain import Registry, classify
from cryoshield_recover.errors import ExitCode
from cryoshield_recover.recover import Recovery
from cryoshield_recover.rpc import JsonRpcClient, RpcError
from cryoshield_recover.ui import Console, sanitize

V2 = vectors.cases("vaults")[0]
BLOB1 = h(V2["blob"])
UPD = vectors.cases("updatePayloadCases")[0]
BLOB2 = h(UPD["expectedBlob"])  # key B replaced the secret: version 2
LOC_A, LOC_B = h(BY_NAME["A"]["locator"]), h(BY_NAME["B"]["locator"])
VID = h(V2["vaultId"])


def _raw(server: Any, body: bytes, path: str | None = None) -> None:
    real = server.handle

    def handle(method: str, p: str, b: bytes) -> Any:
        if path is None or p == path:
            return 200, {"Content-Type": "application/json"}, body
        return real(method, p, b)

    server.handle = handle


def _run(cfg: Any, keys: list[PhysicalKey]) -> tuple[Any, FakePrfSource]:
    ui = RecUI()
    prf = FakePrfSource(keys, ui=ui)
    return Recovery(cfg, prf, ui).run(), prf


# ------------------------------------------------------------------ 1. hostile JSON
HOSTILE_JSON = [
    b"[" * 60000,  # RecursionError in json.loads, fits under 64 KB
    b'{"jsonrpc":"2.0","id":1,"result":NaN}',
    b'{"jsonrpc":"2.0","id":1,"result":Infinity}',
    b'{"jsonrpc":"2.0","id":1,"result":"0x' + b"f" * 5000 + b'"}',
    b"\xff\xfe\x00garbage",
    b'{"jsonrpc":"2.0","id":1,"error":{"message":' + b"[" * 30000 + b"}}",
]


@pytest.mark.parametrize("body", HOSTILE_JSON, ids=lambda b: repr(b[:24]))
def test_hostile_rpc_body_is_rpc_error(body: bytes) -> None:
    with FakeChain() as bad:
        _raw(bad, body)
        c = JsonRpcClient(bad.url)
        with pytest.raises(RpcError):
            hex_val = c.call("eth_chainId", [])
            from cryoshield_recover.rpc import hex_to_int

            hex_to_int(hex_val)


def test_hostile_rpc_does_not_stop_recovery() -> None:
    with FakeChain() as bad, FakeChain() as good:
        _raw(bad, b"[" * 60000)
        good.add_vault(VID, BLOB1, [LOC_A, LOC_B])
        cfg = cfg_for(good)
        cfg.rpcs = [bad.url, good.url]
        res, _ = _run(cfg, [PhysicalKey.named("A")])
        assert bytes(res.secret) == h(V2["secret"])
        assert any(bad.url.split("//")[1] in w for w in res.warnings)


_TAGS = (
    b'"tags":[{"name":"App-Name","value":"CryoShield"},{"name":"CryoShield-Locator","value":"0x'
    + LOC_A.hex().encode()
    + b'"}]'
)
GRAPHQL_HOSTILE = [
    b'{"data":{"transactions":{"edges":[{"node":{"id":"%s","data":{"size":Infinity},' + _TAGS + b"}}]}}}",
    b'{"data":{"transactions":{"edges":[{"node":{"id":"%s","data":{"size":1e999},' + _TAGS + b"}}]}}}",
    b'{"data":{"transactions":{"edges":[{"node":{"id":"%s","data":{"size":NaN},' + _TAGS + b"}}]}}}",
    b'{"data":{"transactions":{"edges":[{"node":{"id":"%s","data":{"size":"99999999999999999999"},'
    + _TAGS
    + b"}}]}}}",
    b'{"data":{"transactions":{"edges":[{"node":{"id":"%s","data":{"size":true},"block":{"height":1e999},'
    + _TAGS
    + b"}}]}}}",
    b'{"data":{"transactions":{"edges":[{"node":{"id":"%s","data":{"size":5},"block":{"height":"NaN"},'
    + _TAGS
    + b"}}]}}}",
    b"[" * 60000,
]


@pytest.mark.parametrize("body", GRAPHQL_HOSTILE, ids=range(len(GRAPHQL_HOSTILE)))
def test_hostile_graphql_does_not_stop_search(body: bytes) -> None:
    with FakeArweave() as bad, FakeArweave() as good:
        tid = good.mirror(BLOB1, vault_id=VID, locators=[LOC_A])
        payload = body.replace(b"%s", tid.encode()) if b"%s" in body else body
        _raw(bad, payload, "/graphql")
        ar = Arweave([bad.graphql_url, good.graphql_url], [good.url], timeout=5)
        txs = ar.find_by_locator(LOC_A)
        assert [t.id for t in txs] == [tid]
        assert ar.fetch(txs[0]) == BLOB1


def test_hostile_graphql_full_recovery_continues() -> None:
    with FakeChain() as chain, FakeArweave() as bad, FakeArweave() as good:
        chain.down = True
        good.mirror(BLOB1, vault_id=VID, locators=[LOC_A])
        _raw(bad, GRAPHQL_HOSTILE[0].replace(b"%s", b"A" * 43), "/graphql")
        cfg = cfg_for(chain, good)
        cfg.arweave_graphql = [bad.graphql_url, good.graphql_url]
        res, _ = _run(cfg, [PhysicalKey.named("A")])
        assert bytes(res.secret) == h(V2["secret"])


# ------------------------------------------------------------------ 2. silent rollback
def _two_chains(stale_logs: bool) -> tuple[FakeChain, FakeChain]:
    liar, honest = FakeChain(), FakeChain()
    honest.add_vault(VID, BLOB1, [LOC_A, LOC_B])
    honest.update_vault(VID, BLOB2)
    liar.add_vault(VID, BLOB1, [LOC_A, LOC_B])
    if not stale_logs:
        liar.update_vault(VID, BLOB2)  # full history...
        owner, _, _ = liar.vaults[VID]
        liar.vaults[VID] = (owner, BLOB1, 1)  # ...but serves the old blob as "current"
    return liar, honest


@pytest.mark.parametrize("stale_logs", [False, True], ids=["lying-state", "lagging-node"])
def test_disagreeing_rpcs_do_not_silently_roll_back(stale_logs: bool) -> None:
    liar, honest = _two_chains(stale_logs)
    with liar, honest:
        cfg = cfg_for(honest)
        cfg.rpcs = [liar.url, honest.url]  # the liar answers first
        res, _ = _run(cfg, [PhysicalKey.named("B")])
    assert bytes(res.secret) == h(UPD["newSecret"]), "stale blob was shown"
    assert any("disagree" in w for w in res.warnings)
    if stale_logs:
        assert res.candidate.freshness is Freshness.UNVERIFIABLE  # histories disagree: no false "current"
    else:
        assert res.candidate.freshness is Freshness.CURRENT


def test_disagreement_demotes_stale_blob_in_ranking() -> None:
    liar, honest = _two_chains(stale_logs=False)
    with liar, honest:
        reg = Registry([liar.url, honest.url], honest.address, TEST_CHAIN_ID)
        cands = reg.fetch([VID])
    by_blob = {c.blob: c.freshness for c in cands}
    assert by_blob[BLOB2] is Freshness.CURRENT
    assert by_blob[BLOB1] is Freshness.OUTDATED


# ------------------------------------------------------------------ 3. terminal escapes
def test_sanitize_strips_control_and_escape_sequences() -> None:
    evil = "ok\x1b]0;pwned\x07\x1b[2J\x9b31m‮evil\x00\x7f\r done"
    out = sanitize(evil)
    for bad in ("\x1b", "\x07", "\x9b", "‮", "\x00", "\x7f", "\r"):
        assert bad not in out
    assert out.startswith("ok") and out.endswith("done")
    assert sanitize("line1\nline2\tx") == "line1\nline2\tx"


def test_remote_error_message_cannot_inject_escapes() -> None:
    evil = "\x1b]0;owned\x07\x1b[2J\x1b[31mFAKE: your vault is empty"
    with FakeChain() as bad:
        _raw(bad, json.dumps({"jsonrpc": "2.0", "id": 1, "error": {"message": evil}}).encode())
        out, err = io.StringIO(), io.StringIO()
        console = Console(io.StringIO("show\n"), out, err, getpass_fn=lambda _p: "1", interactive=True)
        code = cli.main(
            ["--rpc", bad.url, "--registry", bad.address, "--no-arweave"],
            console=console,
            prf_factory=lambda ui: FakePrfSource([PhysicalKey.named("A")], ui=ui),
        )
    text = err.getvalue() + out.getvalue()
    assert code == ExitCode.NETWORK_UNAVAILABLE
    assert "\x1b" not in text and "\x07" not in text
    assert "FAKE: your vault is empty" in text  # content kept, only made inert


# ------------------------------------------------------------------ 4. --vault-id RP-ID redirection
def _foreign_blob(rp_id: str) -> bytes:
    creds = [
        (h(BY_NAME["A"]["id"]), bytearray(os.urandom(32))),
        (h(BY_NAME["B"]["id"]), bytearray(os.urandom(32))),
    ]
    return writer.create(
        vault_id=VID,
        rp_id=rp_id,
        credentials=creds,
        secret=b"attacker",
        mode=1,
        threshold=1,
        rng=writer.FixedRng(os.urandom(100)),
    )


def test_vault_id_prefers_configured_rp_id_over_attacker_arweave_tag() -> None:
    with FakeChain() as chain, FakeArweave() as ar:
        chain.down = True
        ar.mirror(BLOB1, vault_id=VID, locators=[LOC_A], height=10)
        ar.mirror(_foreign_blob("evil.example"), vault_id=VID, locators=[LOC_A], height=999)  # newest
        res, prf = _run(cfg_for(chain, ar, vault_id=VID), [PhysicalKey.named("A", discoverable=False)])
    assert prf.calls[0][0] == "cryoshield.app"
    assert bytes(res.secret) == h(V2["secret"])


def test_vault_id_prefers_chain_rp_id_when_config_differs() -> None:
    with FakeChain() as chain, FakeArweave() as ar:
        chain.add_vault(VID, BLOB1, [LOC_A, LOC_B])
        ar.mirror(_foreign_blob("evil.example"), vault_id=VID, locators=[LOC_A], height=999)
        res, prf = _run(cfg_for(chain, ar, vault_id=VID, rp_id="other.example"), [PhysicalKey.named("A")])
    assert prf.calls[0][0] == "cryoshield.app"
    assert bytes(res.secret) == h(V2["secret"])


def test_vault_id_tries_next_rp_id_when_first_has_no_credential() -> None:
    with FakeChain() as chain, FakeArweave() as ar:
        chain.down = True
        ar.mirror(_foreign_blob("evil.example"), vault_id=VID, locators=[LOC_A], height=999)
        ar.mirror(BLOB1, vault_id=VID, locators=[LOC_A], height=10)
        # configured RP ID is not among candidates; the attacker's comes first by height
        res, prf = _run(cfg_for(chain, ar, vault_id=VID, rp_id="other.example"), [PhysicalKey.named("A")])
    assert [c[0] for c in prf.calls] == ["evil.example", "cryoshield.app"]
    assert bytes(res.secret) == h(V2["secret"])


# ------------------------------------------------------------------ 5. event-hash agreement
def test_event_hashes_need_agreement() -> None:
    liar, honest = _two_chains(stale_logs=True)
    with liar, honest:
        reg = Registry([liar.url, honest.url], honest.address, TEST_CHAIN_ID)
        assert reg.event_hashes(VID) is None
        assert any("disagree" in w for w in reg.warnings)
    with FakeChain() as a, FakeChain() as b:
        for c in (a, b):
            c.add_vault(VID, BLOB1, [LOC_A, LOC_B])
        reg = Registry([a.url, b.url], a.address, TEST_CHAIN_ID)
        got = reg.event_hashes(VID)
        assert got is not None and len(got) == 1
        assert {json.loads(r.body)["method"] for r in b.requests} >= {"eth_getLogs"}, "second RPC consulted"


def test_unmatched_only_on_agreed_empty_history() -> None:
    assert classify(BLOB1, None) is Freshness.UNVERIFIABLE
    assert classify(BLOB1, []) is Freshness.UNMATCHED
    with FakeChain() as a, FakeChain() as b:
        a.add_vault(VID, BLOB1, [LOC_A, LOC_B])  # b has no history for VID: disagreement
        reg = Registry([a.url, b.url], a.address, TEST_CHAIN_ID)
        assert reg.event_hashes(VID) is None


# ------------------------------------------------------------------ 7. whole-request deadline
def test_trickling_server_hits_deadline() -> None:
    class Slow(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            self.send_response(200)
            self.send_header("Content-Length", "1000")
            self.end_headers()
            for _ in range(100):
                try:
                    self.wfile.write(b"x")
                    self.wfile.flush()
                except OSError:
                    return
                time.sleep(0.1)

        def log_message(self, *a: Any) -> None:
            pass

    srv = ThreadingHTTPServer(("127.0.0.1", 0), Slow)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        t0 = time.monotonic()
        with pytest.raises(net.NetError, match="deadline"):
            net.get_capped(f"http://127.0.0.1:{srv.server_address[1]}/x", timeout=0.5, max_bytes=2000)
        assert time.monotonic() - t0 < 2.5
    finally:
        srv.shutdown()
        srv.server_close()


# ------------------------------------------------------------------ round 2 LOWs
def test_two_different_decrypting_copies_without_chain_warn() -> None:
    """Ranking uses the attacker-writable version tag when the chain is down: keep it, but warn."""
    with FakeChain() as chain, FakeArweave() as ar:
        chain.down = True
        ar.mirror(BLOB1, vault_id=VID, locators=[LOC_A, LOC_B], version=1, height=5)
        ar.mirror(BLOB2, vault_id=VID, locators=[LOC_A, LOC_B], version=2, height=6)
        res, _ = _run(cfg_for(chain, ar), [PhysicalKey.named("B")])
    assert bytes(res.secret) == h(UPD["newSecret"])
    assert any("older copy may be shown" in w for w in res.warnings)


def test_single_decrypting_copy_without_chain_no_extra_warning() -> None:
    with FakeChain() as chain, FakeArweave() as ar:
        chain.down = True
        ar.mirror(BLOB1, vault_id=VID, locators=[LOC_A, LOC_B])
        res, _ = _run(cfg_for(chain, ar), [PhysicalKey.named("A")])
    assert not any("older copy may be shown" in w for w in res.warnings)


def test_history_agreement_counts_configured_rpcs() -> None:
    with FakeChain() as a, FakeChain() as down1, FakeChain() as down2:
        a.add_vault(VID, BLOB1, [LOC_A, LOC_B])
        down1.down = down2.down = True
        reg = Registry([a.url, down1.url, down2.url], a.address, TEST_CHAIN_ID)
        assert reg.event_hashes(VID) is None  # 1 of 3 configured answered: unverifiable
        assert any("1 of 3" in w for w in reg.warnings)


def test_remote_error_text_has_no_line_breaks() -> None:
    with FakeChain() as bad:
        _raw(
            bad,
            json.dumps({"jsonrpc": "2.0", "id": 1, "error": {"message": "a\nwarning: fake\rb\tc"}}).encode(),
        )
        with pytest.raises(RpcError) as ei:
            JsonRpcClient(bad.url).call("eth_chainId", [])
    msg = str(ei.value)
    assert "\n" not in msg and "\r" not in msg and "\t" not in msg
    assert "fake" in msg

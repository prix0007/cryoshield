"""RPC client, registry reads, and Arweave fallback against local fake servers (tasks 7.1–7.3)."""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import pytest
from support import vectors
from support.fakes import TEST_CHAIN_ID, FakeArweave, FakeChain
from support.vectors import h

from cryoshield_recover import net
from cryoshield_recover.arweave import Arweave
from cryoshield_recover.candidates import Freshness
from cryoshield_recover.chain import Registry, classify
from cryoshield_recover.rpc import JsonRpcClient, RpcError

V = vectors.cases("vaults")[0]
BLOB = h(V["blob"])
LOC_A = h(V["credentials"][0]["locator"])
LOC_B = h(V["credentials"][1]["locator"])
VID = b"\x01" * 32
JUNK_VID = b"\x02" * 32


# ------------------------------------------------------------------ raw HTTP behaviours
class _Server:
    def __init__(self, handler: Any) -> None:
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()


def _handler(fn: Any) -> type[BaseHTTPRequestHandler]:
    class H(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802
            self.rfile.read(int(self.headers.get("Content-Length") or 0))
            fn(self)

        do_GET = do_POST  # noqa: N815

        def log_message(self, *a: Any) -> None:
            pass

    return H


def _reply(body: bytes, status: int = 200, headers: dict[str, str] | None = None) -> Any:
    def fn(h: BaseHTTPRequestHandler) -> None:
        h.send_response(status)
        for k, v in (headers or {}).items():
            h.send_header(k, v)
        h.send_header("Content-Length", str(len(body)))
        h.end_headers()
        h.wfile.write(body)

    return fn


@pytest.mark.parametrize(
    ("fn", "match"),
    [
        (_reply(b"x" * (70 * 1024)), "larger"),
        (_reply(b"{not json"), "malformed JSON"),
        (_reply(json.dumps({"jsonrpc": "2.0", "id": 1, "error": {"message": "boom"}}).encode()), "boom"),
        (_reply(b"[]"), "malformed"),
        (_reply(b"", 302, {"Location": "https://evil.example/"}), "redirect"),
        (_reply(b"", 500), "HTTP 500"),
    ],
)
def test_rpc_failures_map_to_rpc_error(fn: Any, match: str) -> None:
    s = _Server(_handler(fn))
    try:
        with pytest.raises(RpcError, match=match):
            JsonRpcClient(s.url).call("eth_chainId", [])
    finally:
        s.close()


def test_rpc_timeout() -> None:
    gate = threading.Event()

    def slow(h: BaseHTTPRequestHandler) -> None:
        gate.wait(5)

    s = _Server(_handler(slow))
    try:
        with pytest.raises(RpcError, match="unreachable"):
            JsonRpcClient(s.url, timeout=0.3).call("eth_chainId", [])
    finally:
        gate.set()
        s.close()


def test_rpc_unreachable() -> None:
    with pytest.raises(RpcError):
        JsonRpcClient("http://127.0.0.1:9", timeout=1).call("eth_chainId", [])


def test_rpc_refuses_write_methods() -> None:
    c = JsonRpcClient("http://127.0.0.1:9")
    for m in ("eth_sendRawTransaction", "eth_sendTransaction", "personal_sign"):
        with pytest.raises(ValueError):
            c.call(m, [])


@pytest.mark.parametrize(
    "url",
    ["http://example.com/rpc", "ftp://x.org", "https://user:pw@host.org", "file:///etc/passwd", "not a url"],
)
def test_url_policy(url: str) -> None:
    with pytest.raises(ValueError):
        net.check_url(url)


def test_url_policy_allows_https_and_loopback() -> None:
    assert net.check_url("https://arb1.arbitrum.io/rpc/") == "https://arb1.arbitrum.io/rpc"
    net.check_url("http://127.0.0.1:8545")
    net.check_url("http://localhost:8545")


# ------------------------------------------------------------------ registry
@pytest.fixture
def chain() -> Any:
    with FakeChain() as c:
        c.add_vault(JUNK_VID, b"\xde\xad" * 10, [LOC_A, b"\x09" * 32], owner="0x" + "33" * 20)
        c.add_vault(VID, BLOB, [LOC_A, LOC_B])
        yield c


def _registry(*chains: FakeChain, chain_id: int = TEST_CHAIN_ID) -> Registry:
    return Registry([c.url for c in chains], chains[0].address, chain_id, deploy_block=0, log_chunk=300)


def test_resolve_and_fetch(chain: FakeChain) -> None:
    reg = _registry(chain)
    ids = reg.resolve([LOC_A])
    assert ids == [JUNK_VID, VID]
    cands = reg.fetch(ids)
    assert [c.blob for c in cands] == [b"\xde\xad" * 10, BLOB]
    assert all(c.source == "chain" and c.freshness is Freshness.CURRENT for c in cands)
    assert cands[1].vault_id == VID and cands[1].version == 1


def test_unknown_locator_is_empty(chain: FakeChain) -> None:
    assert _registry(chain).resolve([b"\x77" * 32]) == []


def test_wrong_chain_rpc_ignored(chain: FakeChain) -> None:
    with FakeChain(chain_id=1) as other:
        other.add_vault(b"\x05" * 32, b"evil", [LOC_A])
        reg = _registry(other, chain)
        assert reg.resolve([LOC_A]) == [JUNK_VID, VID]
        assert any("chain 1" in w for w in reg.warnings)


def test_withholding_rpc_does_not_hide_vault(chain: FakeChain) -> None:
    with FakeChain() as liar:
        liar.withhold = True
        reg = _registry(liar, chain)
        assert VID in reg.resolve([LOC_A])
        assert any(c.blob == BLOB for c in reg.fetch([VID]))


def test_malicious_abi_rpc_discarded(chain: FakeChain) -> None:
    with FakeChain() as bad:
        bad.malicious_abi = True
        reg = _registry(bad, chain)
        assert VID in reg.resolve([LOC_A])
        assert any("discarded" in w for w in reg.warnings)


def test_all_rpcs_down() -> None:
    with FakeChain() as c:
        c.down = True
        reg = _registry(c)
        assert reg.usable() == []
        assert reg.resolve([LOC_A]) == []


def test_event_hashes_paged(chain: FakeChain) -> None:
    new_blob = h(vectors.cases("updatePayloadCases")[0]["expectedBlob"])
    chain.update_vault(VID, new_blob)
    hashes = _registry(chain).event_hashes(VID)
    assert hashes is not None and [v for v, _ in hashes] == [1, 2]
    assert classify(new_blob, hashes) is Freshness.VERIFIED
    assert classify(BLOB, hashes) is Freshness.OUTDATED
    assert classify(b"other", hashes) is Freshness.UNMATCHED
    assert classify(BLOB, None) is Freshness.UNVERIFIABLE


def test_event_hashes_unverifiable_on_log_errors(chain: FakeChain) -> None:
    chain.logs_error = True
    reg = _registry(chain)
    assert reg.event_hashes(VID) is None


# ------------------------------------------------------------------ arweave
@pytest.fixture
def ar() -> Any:
    with FakeArweave() as a:
        yield a


def _arweave(a: FakeArweave) -> Arweave:
    return Arweave([a.graphql_url], [a.url], timeout=5)


def test_arweave_find_and_fetch(ar: FakeArweave) -> None:
    tid = ar.mirror(BLOB, vault_id=VID, locators=[LOC_A, LOC_B], height=50)
    ar.mirror(b"x" * 10, vault_id=VID, locators=[b"\x09" * 32])  # other locator: not returned
    client = _arweave(ar)
    txs = client.find_by_locator(LOC_A)
    assert [t.id for t in txs] == [tid]
    assert txs[0].vault_id == VID and txs[0].version == 1 and txs[0].height == 50
    assert client.fetch(txs[0]) == BLOB
    assert [t.id for t in client.find_by_vault_id(VID)]  # both share the vault id tag


def test_arweave_wrong_app_name_ignored(ar: FakeArweave) -> None:
    # A lying GraphQL server returns a tx without our App-Name: it is filtered locally.
    ar.mirror(BLOB, vault_id=VID, locators=[LOC_A], app="Other")
    real = ar.handle

    def lie(method: str, path: str, body: bytes) -> Any:
        if path == "/graphql":
            q = json.loads(body)
            q["variables"]["tags"] = [t for t in q["variables"]["tags"] if t["name"] != "App-Name"]
            body = json.dumps(q).encode()
        return real(method, path, body)

    ar.handle = lie  # type: ignore[method-assign]
    assert _arweave(ar).find_by_locator(LOC_A) == []


def test_arweave_oversize_declared_is_not_downloaded(ar: FakeArweave) -> None:
    ar.mirror(b"y" * 2000, vault_id=VID, locators=[LOC_A], declared_size=2000)
    client = _arweave(ar)
    tx = client.find_by_locator(LOC_A)[0]
    assert client.fetch(tx) is None
    assert not any(r.method == "GET" for r in ar.requests)


def test_arweave_lying_size_is_capped(ar: FakeArweave) -> None:
    ar.mirror(b"y" * 5000, vault_id=VID, locators=[LOC_A], declared_size=100)
    client = _arweave(ar)
    assert client.fetch(client.find_by_locator(LOC_A)[0]) is None
    assert any("larger" in w for w in client.warnings)


def test_arweave_down(ar: FakeArweave) -> None:
    ar.down = True
    client = _arweave(ar)
    assert client.find_by_locator(LOC_A) == []
    assert client.warnings

"""fix-arweave-raw-fetch: data comes from `<gateway>/raw/<id>`; redirects stay refused; dead gateways fall through.

Real ar.io gateways (2026-10-12) answer `/<id>` with a 302 to a per-item sandbox host and serve the bytes only on
`/raw/<id>`. `FakeArweave` behaves the same way, so the old fetch path fails these tests.
"""

from __future__ import annotations

from support.fakes import FakeArweave

from cryoshield_recover import arweave as arw
from cryoshield_recover.arweave import Arweave, ArweaveTx
from cryoshield_recover.config import ARWEAVE_GATEWAYS, ARWEAVE_GRAPHQL

VID = bytes(range(32))
LOC = bytes([7] * 32)
BLOB = b"\x01" + bytes(range(200))


def _tx(tid: str) -> ArweaveTx:
    return ArweaveTx(id=tid, size=None, height=1, vault_id=VID, version=None, locators=[LOC], server="g")


def test_fetch_reads_raw_path_not_the_redirecting_plain_path() -> None:
    with FakeArweave() as ar:
        tid = ar.mirror(BLOB, vault_id=VID, locators=[LOC])
        a = Arweave([ar.graphql_url], [ar.url])
        assert a.fetch(_tx(tid)) == BLOB
        gets = [r.path for r in ar.requests if r.method == "GET"]
        assert gets == [f"/raw/{tid}"]
        assert a.warnings == []


def test_redirect_on_raw_is_refused_and_next_gateway_used() -> None:
    with FakeArweave() as bad, FakeArweave() as good:
        bad.redirect_raw = True
        tid = bad.mirror(BLOB, vault_id=VID, locators=[LOC])
        assert good.mirror(BLOB, vault_id=VID, locators=[LOC]) == tid
        a = Arweave([good.graphql_url], [bad.url, good.url])
        assert a.fetch(_tx(tid)) == BLOB
        assert any("refusing redirect" in w for w in a.warnings)
        # The redirect target was never contacted: only the two configured gateways saw requests.
        assert [r.path for r in bad.requests] == [f"/raw/{tid}"]
        assert [r.path for r in good.requests] == [f"/raw/{tid}"]


def test_unresolvable_first_gateway_falls_through_to_second() -> None:
    with FakeArweave() as good:
        tid = good.mirror(BLOB, vault_id=VID, locators=[LOC])
        a = Arweave([good.graphql_url], ["https://gateway.invalid", good.url], timeout=5)
        assert a.fetch(_tx(tid)) == BLOB
        assert any("gateway.invalid" in w for w in a.warnings)


def test_raw_url_is_built_from_validated_id_only(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    urls: list[str] = []

    def get(url: str, **kw: object) -> bytes:
        urls.append(url)
        return BLOB

    monkeypatch.setattr(arw, "get_capped", get)
    a = Arweave(["https://g.example/graphql"], ["https://gw.example"])
    assert a.fetch(_tx("A" * 43)) == BLOB
    assert urls == ["https://gw.example/raw/" + "A" * 43]


def test_default_gateways_serve_raw_and_are_independent() -> None:
    """D2: two operators (ar.io's arweave.net, ArDrive's turbo-gateway.com); ar-io.net no longer resolves."""
    assert ARWEAVE_GATEWAYS == ("https://arweave.net", "https://turbo-gateway.com")
    assert all("ar-io.net" not in u for u in ARWEAVE_GATEWAYS + ARWEAVE_GRAPHQL)
    assert len(set(ARWEAVE_GRAPHQL)) >= 2

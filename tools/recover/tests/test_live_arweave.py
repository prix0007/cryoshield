"""Live, READ-ONLY Arweave check (opt-in: ``pytest -m network --run-network``); fix-arweave-raw-fetch.

Downloads one known public CryoShield item through every built-in gateway with the tool's own fetch path
(``<gateway>/raw/<id>``, redirects refused) and checks its bytes. The item is the founder's OP Sepolia dev vault,
version 11 (999 bytes, maximum-padded, three keys): public ciphertext, no secret. Run before a release (release
checklist, step 3.2): a gateway that starts redirecting `/raw/`, or stops resolving, fails here first.
"""

from __future__ import annotations

import hashlib

import pytest

from cryoshield_recover.arweave import Arweave, ArweaveTx
from cryoshield_recover.config import ARWEAVE_GATEWAYS, ARWEAVE_GRAPHQL
from cryoshield_recover.format import decode_blob

ITEM = "zIJNxEtKEtQGUY_3rveaVJCtpnFqyydci-1EPz0Ybj4"
VAULT_ID = bytes.fromhex("94a68b0b3a014671a1cd07f1ba0d6bcda98306c297ce15a3ccbbe491c1505e87")
SIZE = 999
SHA256_PREFIX = "68844c2de915"


@pytest.mark.network
@pytest.mark.parametrize("gateway", ARWEAVE_GATEWAYS)
def test_each_default_gateway_serves_raw_bytes(gateway: str) -> None:
    a = Arweave(ARWEAVE_GRAPHQL, [gateway], timeout=20)
    tx = ArweaveTx(id=ITEM, size=None, height=1, vault_id=VAULT_ID, version=11, locators=[], server="live")
    data = a.fetch(tx)
    assert data is not None, a.warnings
    assert len(data) == SIZE
    assert hashlib.sha256(data).hexdigest().startswith(SHA256_PREFIX)
    v = decode_blob(data)
    assert v.rp_id == "cryoshield-web-dev.fly.dev" and v.count == 3

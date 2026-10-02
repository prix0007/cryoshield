"""Live, READ-ONLY smoke test against real OP Sepolia (opt-in: ``pytest -m network``).

Sends only eth_chainId / eth_call to the built-in public RPCs. No key, no transaction, no secret.
"""

from __future__ import annotations

import os

import pytest

from cryoshield_recover import abi
from cryoshield_recover.chain import Registry
from cryoshield_recover.config import NETWORKS
from cryoshield_recover.keccak import keccak256
from cryoshield_recover.rpc import hex_to_bytes

pytestmark = pytest.mark.network

P = NETWORKS["op-sepolia"]


def test_registry_live_and_random_locator_resolves_empty_on_two_plus_rpcs() -> None:
    reg = Registry(P.rpcs, P.registry, P.chain_id, P.deploy_block)
    usable = reg.usable()
    assert len(usable) >= 2, f"fewer than 2 built-in RPCs usable: {reg.warnings}"

    locator = os.urandom(32)
    answers = []
    for c in usable:
        # The contract is really there: MAX_BLOB_SIZE() == 1024.
        raw = hex_to_bytes(
            c.call(
                "eth_call",
                [{"to": P.registry, "data": "0x" + keccak256(b"MAX_BLOB_SIZE()")[:4].hex()}, "latest"],
            ),
            max_len=64,
        )
        assert int.from_bytes(raw, "big") == 1024, c.host
        raw = hex_to_bytes(
            c.call(
                "eth_call",
                [
                    {
                        "to": P.registry,
                        "data": "0x" + abi.encode_call(abi.SEL_RESOLVE_LOCATOR, locator).hex(),
                    },
                    "latest",
                ],
            ),
            max_len=4096,
        )
        answers.append(abi.decode_bytes32_array(raw))
    assert all(a == [] for a in answers), answers
    assert reg.resolve([locator]) == []
    print(f"PASS: {len(usable)} RPCs agree: random locator unknown; registry {P.registry} live")

"""Live, READ-ONLY smoke test against real OP Sepolia (opt-in: ``pytest -m network``).

Sends only eth_chainId / eth_call to the built-in public RPCs. No key, no transaction, no secret.

Every built-in registry of the preset is checked (v2 and v1 today), through the same ``Registries``
reader the CLI uses (fix-recover-live-test; pre-production review F4). The offline test at the bottom
runs by default and builds that reader without any request, so a change to the preset's shape fails the
default run instead of only this opt-in one.
"""

from __future__ import annotations

import os

import pytest

from cryoshield_recover import abi
from cryoshield_recover.chain import Registries
from cryoshield_recover.config import NETWORKS
from cryoshield_recover.keccak import keccak256
from cryoshield_recover.rpc import JsonRpcClient, hex_to_bytes

P = NETWORKS["op-sepolia"]
SEL_MAX_BLOB_SIZE = keccak256(b"MAX_BLOB_SIZE()")[:4]


def live_registries() -> Registries:
    """The reader for every built-in OP Sepolia registry, newest first. Builds clients only; no request."""
    return Registries.build(P.rpcs, P.chain_id, P.registries)


def _call(c: JsonRpcClient, to: str, data: bytes, max_len: int) -> bytes:
    return hex_to_bytes(
        c.call("eth_call", [{"to": to, "data": "0x" + data.hex()}, "latest"]), max_len=max_len
    )


def _get_vaults_empty() -> bytes:
    """getVaults(bytes32[]) with an empty array: selector, offset 0x20, length 0."""
    return abi.SEL_GET_VAULTS + (32).to_bytes(32, "big") + (0).to_bytes(32, "big")


@pytest.mark.network
def test_every_registry_live_and_random_locator_resolves_empty_on_two_plus_rpcs() -> None:
    regs = live_registries()
    usable = regs.usable()
    assert len(usable) >= 2, f"fewer than 2 built-in RPCs usable: {regs.warnings}"

    locator = os.urandom(32)
    for reg in regs.registries:
        for c in usable:
            where = f"registry v{reg.version} {reg.address} via {c.host}"
            # The contract is really there: MAX_BLOB_SIZE() == 1024.
            raw = _call(c, reg.address, SEL_MAX_BLOB_SIZE, 64)
            assert int.from_bytes(raw, "big") == 1024, where
            if reg.kind == 1:
                raw = _call(c, reg.address, abi.encode_call(abi.SEL_RESOLVE_LOCATOR, locator), 4096)
                assert abi.decode_bytes32_array(raw) == [], where
            else:
                raw = _call(c, reg.address, abi.encode_call(abi.SEL_LOCATOR_LENGTH, locator), 64)
                assert abi.decode_uint256(raw) == 0, where
                raw = _call(c, reg.address, _get_vaults_empty(), 4096)
                assert abi.decode_vaults(raw, 0) == [], where
    assert regs.resolve([locator]) == []
    names = ", ".join(f"v{r.version} {r.address}" for r in regs.registries)
    print(f"PASS: {len(usable)} RPCs agree: random locator unknown; registries {names} live")


def test_live_check_covers_every_builtin_registry() -> None:
    """Offline (always runs): the live check targets exactly the preset's registries, v2 then v1."""
    regs = live_registries()
    assert [r.version for r in regs.registries] == [2, 1]
    assert [r.version for r in regs.registries] == [s.version for s in P.registries]
    assert [r.address for r in regs.registries] == [s.address.lower() for s in P.registries]
    assert [r.kind for r in regs.registries] == [2, 1]
    assert [r.deploy_block for r in regs.registries] == [s.deploy_block for s in P.registries]
    assert all(r.trusted and r.builtin for r in regs.registries)
    assert regs.registries[0].session.chain_id == P.chain_id == 11155420

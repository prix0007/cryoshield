"""A v2-only deployment, shaped like OP Mainnet, on a real EVM (OpenSpec change launch-op-mainnet, 3.3).

A fresh anvil with chain ID 10 gets only VaultRegistryV2 (no v1 contract anywhere) and one vault. The
``op-mainnet`` preset is replaced, for this test only, by what task 7.3 will generate from ``10.json``:
one built-in v2 entry and no v1 (the v1 "placeholder" is the absence of an entry). The real CLI then runs
with NO network flag (the default is op-mainnet), finds and opens the vault, and every RPC request is
recorded to show it never reads anything but registry v2. Skipped only when Foundry is missing.
"""

from __future__ import annotations

import os
import socket
import subprocess
import time
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import pytest
from support import writer
from support.keys import BY_NAME
from support.vectors import h
from test_anvil_e2e import _create_vault_calldata, _key, _main, _rpc, _send, _term
from test_anvil_v2 import CONTRACTS, HAVE_FOUNDRY, _deploy, _vault_id_for

from cryoshield_recover import config, rpc
from cryoshield_recover.config import NetworkPreset, RegistrySpec
from cryoshield_recover.errors import ExitCode
from cryoshield_recover.format import MODE_ANY_OF_N
from cryoshield_recover.keccak import keccak256

pytestmark = [
    pytest.mark.anvil,
    pytest.mark.skipif(not HAVE_FOUNDRY, reason="Foundry not installed"),
]

OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"  # anvil's public dev account 1
LOC_A = h(BY_NAME["A"]["locator"])
LOC_B = h(BY_NAME["B"]["locator"])
SALT = keccak256(b"recover-anvil-mainnet-shape")
SECRET = b"mainnet-shaped vault secret for anvil"
# v1-only read selectors (VaultRegistry v1): getVault(bytes32) and resolveLocator(bytes32).
V1_SELECTORS = {
    "0x" + keccak256(b"getVault(bytes32)")[:4].hex(),
    "0x" + keccak256(b"resolveLocator(bytes32)")[:4].hex(),
}


@pytest.fixture(scope="module")
def anvil10() -> Iterator[str]:
    """Its own anvil with OP Mainnet's chain ID, so no other module's v1 deployment is on it."""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    proc = subprocess.Popen(
        ["anvil", "--port", str(port), "--chain-id", "10", "--silent"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    url = f"http://127.0.0.1:{port}"
    try:
        for _ in range(100):
            try:
                assert _rpc(url, "eth_chainId", []) == "0xa"
                break
            except OSError:
                time.sleep(0.1)
        yield url
    finally:
        proc.terminate()
        proc.wait(5)


@dataclass(frozen=True)
class V2Only:
    url: str
    v2: str
    block: int
    vault_id: bytes


@pytest.fixture(scope="module")
def v2_only(anvil10: str) -> V2Only:
    assert CONTRACTS.is_dir()
    v2, block = _deploy(anvil10, "VaultRegistryV2")
    vault_id = _vault_id_for(anvil10, v2, OWNER, SALT)
    creds = [(h(BY_NAME[n]["id"]), bytearray(h(BY_NAME[n]["prf"]))) for n in ("A", "B")]
    blob = writer.create(
        vault_id=vault_id,
        rp_id="cryoshield.app",
        credentials=creds,
        secret=SECRET,
        mode=MODE_ANY_OF_N,
        threshold=1,
        rng=writer.FixedRng(os.urandom(200)),
    )
    rc = _send(anvil10, OWNER, _create_vault_calldata(SALT, blob, [LOC_A, LOC_B]), v2)
    assert rc["status"] == "0x1"
    return V2Only(anvil10, v2.lower(), block, vault_id)


@pytest.fixture
def mainnet_shaped(v2_only: V2Only, monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, list[Any]]]:
    """op-mainnet as 7.3 will ship it (v2 only), pointed at the local chain; records every request."""
    monkeypatch.setitem(
        config.NETWORKS,
        "op-mainnet",
        NetworkPreset("op-mainnet", 10, (RegistrySpec(2, v2_only.v2, v2_only.block),), (v2_only.url,)),
    )
    seen: list[tuple[str, list[Any]]] = []
    real = rpc.JsonRpcClient.call

    def recording(self: rpc.JsonRpcClient, method: str, params: list[Any], *a: Any, **k: Any) -> Any:
        seen.append((method, params))
        return real(self, method, params, *a, **k)

    monkeypatch.setattr(rpc.JsonRpcClient, "call", recording)
    return seen


def _targets(seen: list[tuple[str, list[Any]]]) -> set[str]:
    out: set[str] = set()
    for method, params in seen:
        if method in ("eth_call", "eth_getLogs") and params and isinstance(params[0], dict):
            target = params[0].get("to") or params[0].get("address")
            out.update(t.lower() for t in (target if isinstance(target, list) else [target]))
    return out


def test_default_network_finds_and_opens_a_v2_only_vault(
    v2_only: V2Only, mainnet_shaped: list[tuple[str, list[Any]]]
) -> None:
    console, out, err = _term("show\n")
    code = _main(["--no-arweave"], console, _key("A"))  # no --network, --testnet, --chain-id or --rpc
    log = err.getvalue()
    assert code == ExitCode.OK, log
    assert SECRET.decode() in out.getvalue()
    assert f"0x{v2_only.vault_id.hex()}" in log
    assert "Network: op-mainnet (chain 10)" in log and "use --testnet" in log
    assert f"registry v2 {v2_only.v2}" in log and "registry v1" not in log
    # Only registry v2 was read: no other contract address, no v1 read function.
    assert any(m == "eth_call" for m, _ in mainnet_shaped)
    assert _targets(mainnet_shaped) == {v2_only.v2}
    calls = [p[0].get("data", "")[:10] for m, p in mainnet_shaped if m == "eth_call"]
    assert not V1_SELECTORS.intersection(calls)


def test_list_on_a_v2_only_network(v2_only: V2Only, mainnet_shaped: list[tuple[str, list[Any]]]) -> None:
    console, out, err = _term("")
    code = _main(["--no-arweave", "--list"], console, _key("B"))
    assert code == ExitCode.OK, err.getvalue()
    assert f"0x{v2_only.vault_id.hex()}" in out.getvalue() + err.getvalue()
    assert SECRET.decode() not in out.getvalue() + err.getvalue()
    assert _targets(mainnet_shaped) == {v2_only.v2}

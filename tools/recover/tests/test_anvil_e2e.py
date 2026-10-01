"""End-to-end against a real EVM: deploy the real VaultRegistry to anvil, store a vector vault, then run
the real CLI (real python-fido2 client over a software CTAP2 device returning the vector PRF output)
and recover it via eth_call. Skipped automatically when Foundry (anvil, forge) is not installed.
"""

from __future__ import annotations

import io
import json
import shutil
import socket
import subprocess
import time
import urllib.request
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from support import vectors
from support.keys import BY_NAME
from support.soft_ctap import SoftAuthenticator, SoftCred
from support.vectors import REPO_ROOT, h

from cryoshield_recover import cli
from cryoshield_recover.authenticator import Fido2PrfSource
from cryoshield_recover.derive import ctap_salt
from cryoshield_recover.errors import ExitCode
from cryoshield_recover.keccak import keccak256
from cryoshield_recover.ui import Console

pytestmark = [
    pytest.mark.anvil,
    pytest.mark.skipif(not (shutil.which("anvil") and shutil.which("forge")), reason="Foundry not installed"),
]

CONTRACTS = REPO_ROOT / "contracts"
V2 = {v["name"]: v for v in vectors.cases("vaults")}["any-of-2"]
UPDATE = vectors.cases("updatePayloadCases")[0]  # key B replaces the any-of-2 secret
PIN = "246813"
# anvil's default unlocked dev accounts (public, well-known)
DEPLOYER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
SQUATTER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"


def _rpc(url: str, method: str, params: list[Any]) -> Any:
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(url, body, {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:  # noqa: S310 - loopback only
        resp = json.loads(r.read())
    if "error" in resp:
        raise RuntimeError(resp["error"])
    return resp["result"]


def _send(url: str, sender: str, data: bytes, to: str | None = None) -> dict[str, Any]:
    tx: dict[str, Any] = {"from": sender, "data": "0x" + data.hex(), "gas": hex(5_000_000)}
    if to:
        tx["to"] = to
    txh = _rpc(url, "eth_sendTransaction", [tx])
    for _ in range(50):
        rc = _rpc(url, "eth_getTransactionReceipt", [txh])
        if rc:
            assert int(rc["status"], 16) == 1, f"tx reverted: {rc}"
            return rc  # type: ignore[no-any-return]
        time.sleep(0.05)
    raise TimeoutError(txh)


def _word(n: int) -> bytes:
    return n.to_bytes(32, "big")


def _create_vault_calldata(vault_id: bytes, blob: bytes, locators: list[bytes]) -> bytes:
    sel = keccak256(b"createVault(bytes32,bytes,bytes32[])")[:4]
    padded = blob + b"\x00" * (-len(blob) % 32)
    off_blob = 3 * 32
    off_locs = off_blob + 32 + len(padded)
    return (
        sel
        + vault_id
        + _word(off_blob)
        + _word(off_locs)
        + _word(len(blob))
        + padded
        + _word(len(locators))
        + b"".join(locators)
    )


def _update_vault_calldata(vault_id: bytes, blob: bytes) -> bytes:
    sel = keccak256(b"updateVault(bytes32,bytes)")[:4]
    padded = blob + b"\x00" * (-len(blob) % 32)
    return sel + vault_id + _word(64) + _word(len(blob)) + padded


@pytest.fixture(scope="module")
def anvil() -> Iterator[str]:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    proc = subprocess.Popen(
        ["anvil", "--port", str(port), "--silent"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    url = f"http://127.0.0.1:{port}"
    try:
        for _ in range(100):
            try:
                _rpc(url, "eth_chainId", [])
                break
            except OSError:
                time.sleep(0.1)
        yield url
    finally:
        proc.terminate()
        proc.wait(5)


@pytest.fixture(scope="module")
def registry(anvil: str) -> tuple[str, int]:
    code = (
        subprocess.run(
            ["forge", "inspect", "VaultRegistry", "bytecode"],
            cwd=CONTRACTS,
            capture_output=True,
            text=True,
            check=True,
        )
        .stdout.strip()
        .splitlines()[-1]
    )
    rc = _send(anvil, DEPLOYER, bytes.fromhex(code.removeprefix("0x")))
    return rc["contractAddress"], int(rc["blockNumber"], 16)


VAULT_ID = h(V2["vaultId"])  # the blob is bound to it (vault-format-v1 §4.1)
LOC_A = h(BY_NAME["A"]["locator"])
LOC_B = h(BY_NAME["B"]["locator"])


@pytest.fixture(scope="module")
def stored(anvil: str, registry: tuple[str, int]) -> tuple[str, int]:
    addr, block = registry
    # A squatter front-runs junk under locator A first; the genuine vault is appended after it.
    _send(
        anvil,
        SQUATTER,
        _create_vault_calldata(keccak256(b"junk"), b"CRYO" + b"\x00" * 200, [LOC_A, keccak256(b"junk-loc")]),
        addr,
    )
    _send(anvil, OWNER, _create_vault_calldata(VAULT_ID, h(V2["blob"]), [LOC_A, LOC_B]), addr)
    return addr, block


def _term(answer: str = "show\n", interactive: bool = True) -> tuple[Console, io.StringIO, io.StringIO]:
    out, err = io.StringIO(), io.StringIO()
    return (
        Console(io.StringIO(answer), out, err, getpass_fn=lambda _p: PIN, interactive=interactive),
        out,
        err,
    )


def _key(*names: str, discoverable: bool = True) -> SoftAuthenticator:
    return SoftAuthenticator(
        [SoftCred("cryoshield.app", h(BY_NAME[n]["id"]), h(BY_NAME[n]["prf"]), discoverable) for n in names],
        expected_salt=ctap_salt(),
        pin=PIN,
    )


def _main(args: list[str], console: Console, dev: SoftAuthenticator) -> int:
    def factory(ui: Console) -> Fido2PrfSource:
        return Fido2PrfSource(ui, list_devices=lambda: [dev], use_windows_api=lambda: False)

    return cli.main(args, console=console, prf_factory=factory)


def _args(anvil: str, stored: tuple[str, int]) -> list[str]:
    addr, block = stored
    return [
        "--rpc",
        anvil,
        "--registry",
        addr,
        "--chain-id",
        "31337",
        "--deploy-block",
        str(block),
        "--no-arweave",
    ]


def test_keyless_recovery_from_anvil(anvil: str, stored: tuple[str, int], tmp_path: Path) -> None:
    out_file = tmp_path / "secret.txt"
    console, out, err = _term(interactive=False)
    dev = _key("A")
    code = _main([*_args(anvil, stored), "--output", str(out_file)], console, dev)
    assert code == ExitCode.OK, err.getvalue()
    assert out_file.read_bytes() == h(V2["secret"])
    assert out.getvalue() == ""
    log = err.getvalue()
    assert "found on the blockchain" in log and f"0x{VAULT_ID.hex()}" in log
    assert "Ignored 1 other candidate" in log
    assert dev.seen_salts and all(s == ctap_salt() for s in dev.seen_salts)


def test_vault_id_recovery_after_update_from_anvil(anvil: str, stored: tuple[str, int]) -> None:
    addr, _ = stored
    _send(anvil, OWNER, _update_vault_calldata(VAULT_ID, h(UPDATE["expectedBlob"])), addr)
    console, out, err = _term("show\n")
    dev = _key("B", discoverable=False)  # not discoverable: needs --vault-id
    code = _main([*_args(anvil, stored), "--vault-id", VAULT_ID.hex()], console, dev)
    assert code == ExitCode.OK, err.getvalue()
    assert h(UPDATE["newSecret"]).decode() in out.getvalue()


def test_unenrolled_key_finds_nothing(anvil: str, stored: tuple[str, int]) -> None:
    console, out, err = _term()
    code = _main(_args(anvil, stored), console, _key("C"))
    assert code == ExitCode.NO_MATCHING_VAULT
    assert out.getvalue() == ""


def test_wrong_chain_id_is_refused(anvil: str, stored: tuple[str, int]) -> None:
    addr, block = stored
    console, out, err = _term()
    args = ["--rpc", anvil, "--registry", addr, "--chain-id", "42161", "--no-arweave"]
    code = _main(args, console, _key("A"))
    assert code == ExitCode.NETWORK_UNAVAILABLE
    assert "chain 31337" in err.getvalue()

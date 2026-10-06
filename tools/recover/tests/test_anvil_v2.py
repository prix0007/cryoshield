"""VaultRegistry v2 against a real EVM (OpenSpec change harden-gas-sponsorship, task 3.6).

Deploys the real VaultRegistry (v1) and VaultRegistryV2 to anvil, checks the registry's sender-derived
vaultId against an independent local derivation, stuffs a key's locator past one page, and recovers
through the real CLI with both registries configured. Skipped only when Foundry is missing (CI's
recover job installs it, so these run there); ``CRYOSHIELD_CONTRACTS_DIR`` may point at another
checkout of ``contracts/``.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest
from support import writer
from support.keys import BY_NAME
from support.vectors import REPO_ROOT, h
from test_anvil_e2e import (
    DEPLOYER,
    OWNER,
    V2,
    _create_vault_calldata,
    _key,
    _main,
    _rpc,
    _send,
    _term,
    _word,
    anvil,  # noqa: F401 - module-scoped fixture reused here
)

from cryoshield_recover.errors import ExitCode
from cryoshield_recover.format import MODE_ANY_OF_N
from cryoshield_recover.keccak import keccak256

CONTRACTS = Path(os.environ.get("CRYOSHIELD_CONTRACTS_DIR", REPO_ROOT / "contracts"))

pytestmark = [
    pytest.mark.anvil,
    pytest.mark.skipif(not (shutil.which("anvil") and shutil.which("forge")), reason="Foundry not installed"),
]

LOC_A = h(BY_NAME["A"]["locator"])
LOC_B = h(BY_NAME["B"]["locator"])
V1_VAULT_ID = h(V2["vaultId"])  # the any-of-2 vector vault, kept in v1
SALT = keccak256(b"recover-anvil-v2-salt")
SECRET = b"v2 vault secret for anvil"
JUNK = 300  # > one 256-entry page


def _deploy(url: str, name: str) -> tuple[str, int]:
    out = subprocess.run(
        ["forge", "inspect", name, "bytecode"], cwd=CONTRACTS, capture_output=True, text=True, check=True
    )
    rc = _send(url, DEPLOYER, bytes.fromhex(out.stdout.strip().splitlines()[-1].removeprefix("0x")))
    return rc["contractAddress"], int(rc["blockNumber"], 16)


def _create_v2_calldata(salt: bytes, blob: bytes, locators: list[bytes]) -> bytes:
    # createVault(bytes32 salt, bytes blob, bytes32[] locators): same layout as v1, salt in place of id
    return _create_vault_calldata(salt, blob, locators)


def _vault_id_for(url: str, registry: str, owner: str, salt: bytes) -> bytes:
    data = keccak256(b"vaultIdFor(address,bytes32)")[:4] + bytes(12) + bytes.fromhex(owner[2:]) + salt
    res = _rpc(url, "eth_call", [{"to": registry, "data": "0x" + data.hex()}, "latest"])
    return bytes.fromhex(res[2:])


@pytest.fixture(scope="module")
def deployed(anvil: str) -> dict[str, object]:  # noqa: F811 - pytest fixture injection
    v1, v1_block = _deploy(anvil, "VaultRegistry")
    v2, v2_block = _deploy(anvil, "VaultRegistryV2")

    # Independent derivation: keccak256(abi.encode(owner, salt)) == the registry's own answer.
    local_id = keccak256(bytes(12) + bytes.fromhex(OWNER[2:]) + SALT)
    vault_id = _vault_id_for(anvil, v2, OWNER, SALT)
    assert vault_id == local_id

    # Stuffing: JUNK vaults from fresh senders under locator A, BEFORE the genuine vault (pre-stuffed).
    _rpc(anvil, "anvil_autoImpersonateAccount", [True])
    for i in range(JUNK):
        sender = "0x" + keccak256(b"stuffer" + i.to_bytes(4, "big"))[:20].hex()
        _rpc(anvil, "anvil_setBalance", [sender, hex(10**18)])
        _send(
            anvil,
            sender,
            _create_v2_calldata(_word(i + 1), b"CRYO" + b"\x00" * 60, [LOC_A, _word(10**6 + i)]),
            v2,
        )

    creds = [(h(BY_NAME["A"]["id"]), bytearray(h(BY_NAME["A"]["prf"])))]
    creds.append((h(BY_NAME["B"]["id"]), bytearray(h(BY_NAME["B"]["prf"]))))
    blob = writer.create(
        vault_id=vault_id,
        rp_id="cryoshield.app",
        credentials=creds,
        secret=SECRET,
        mode=MODE_ANY_OF_N,
        threshold=1,
        rng=writer.FixedRng(os.urandom(200)),
    )
    rc = _send(anvil, OWNER, _create_v2_calldata(SALT, blob, [LOC_A, LOC_B]), v2)
    assert rc["status"] == "0x1"
    # An old vault of the same key in v1 (another owner account: v1 and v2 are separate registries).
    _send(anvil, DEPLOYER, _create_vault_calldata(V1_VAULT_ID, h(V2["blob"]), [LOC_A, LOC_B]), v1)
    return {"v1": v1, "v1_block": v1_block, "v2": v2, "v2_block": v2_block, "vault_id": vault_id}


def _args(url: str, d: dict[str, object], *, v1: bool = True) -> list[str]:
    args = ["--rpc", url, "--chain-id", "31337", "--no-arweave"]
    args += ["--registry-v2", str(d["v2"]), "--deploy-block-v2", str(d["v2_block"])]
    if v1:
        args += ["--registry", str(d["v1"]), "--deploy-block", str(d["v1_block"])]
    else:
        args += ["--registry", "0x" + "00" * 20]
    return args


def test_v2_vault_behind_stuffing_recovers(anvil: str, deployed: dict[str, object]) -> None:  # noqa: F811
    """Both registries: the v2 vault (behind 300 junk entries) is opened, ahead of the older v1 vault."""
    console, out, err = _term("show\n")
    code = _main(_args(anvil, deployed), console, _key("A"))
    assert code == ExitCode.OK, err.getvalue()
    assert SECRET.decode() in out.getvalue()
    assert f"0x{bytes(deployed['vault_id']).hex()}" in err.getvalue()  # type: ignore[arg-type]


def test_v2_only_chain_recovers(anvil: str, deployed: dict[str, object]) -> None:  # noqa: F811
    console, out, err = _term("show\n")
    code = _main(_args(anvil, deployed, v1=False), console, _key("A"))
    assert code == ExitCode.OK, err.getvalue()
    assert SECRET.decode() in out.getvalue()


def test_old_v1_vault_still_opens_by_id(anvil: str, deployed: dict[str, object]) -> None:  # noqa: F811
    console, out, err = _term("show\n")
    code = _main([*_args(anvil, deployed), "--vault-id", V1_VAULT_ID.hex()], console, _key("A"))
    assert code == ExitCode.OK, err.getvalue()
    assert h(V2["secret"]).decode() in out.getvalue()

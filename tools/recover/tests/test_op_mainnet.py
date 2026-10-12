"""The op-mainnet preset vs contracts/deployments/10.json (OpenSpec change launch-op-mainnet, task 3.1).

OP Mainnet carries only VaultRegistry v2 (design D1, D5). Until the owner's deploy writes ``10.json``
(task 7.2), the preset has no registry, so blockchain lookup is off and the tool says so (vault-recovery
spec, "OP Mainnet preset from the deployment record"). Once ``10.json`` is committed (task 7.3),
``test_op_mainnet_preset_matches_its_record`` fails until the preset carries exactly the record's v2
address and deploy block, and prints the line to paste. The generic every-record parity check is
``test_registry_versions.py::test_presets_match_deployment_records``.
"""

from __future__ import annotations

import json
from typing import Any

from support.vectors import REPO_ROOT

from cryoshield_recover import deployments
from cryoshield_recover.config import NETWORKS, NetworkPreset, RegistrySpec

MAINNET_RECORD = REPO_ROOT / "contracts" / "deployments" / "10.json"
# Test-only fixture values: the D1 CREATE2 address (equal on every chain) and a made-up block. Never the
# real record (task 7.3 commits that).
FIXTURE_V2 = "0xa622c92d3d5b54aea081cf410224a8a2ecb08cb7"
FIXTURE_BLOCK = 123_456_789
V2_HASH = "0xacb135ccf895846a59981b20545041660e21942c6108c000d9f1c46f552cb95c"
V1_HASH = "0x978e16a51813cacf2f723f72db77d1e10c186e489ccf4cca8ec8bb4517cd0a07"


def mainnet_parity_errors(preset: NetworkPreset, data: dict[str, Any] | None) -> list[str]:
    """Everything wrong between the op-mainnet preset and ``10.json`` (None: no record yet)."""
    errors: list[str] = []
    if preset.chain_id != 10:
        errors.append(f"{preset.name} is chain {preset.chain_id}, not 10")
    if any(s.version == 1 for s in preset.registries):
        errors.append(f"{preset.name} carries a VaultRegistry v1; v1 is never deployed on OP Mainnet")
    if data is None:
        if preset.registries:
            errors.append(
                f"{preset.name} has built-in registries but contracts/deployments/10.json does not exist; "
                "with no record, blockchain lookup must stay off"
            )
        return errors
    if data.get("chainId") != 10:
        errors.append(f"10.json has chainId {data.get('chainId')!r}, not 10")
    if "address" in data:
        errors.append("10.json has a top-level (VaultRegistry v1) address; chain 10 must have none")
    v2 = data.get("contracts", {}).get("vaultRegistryV2") if isinstance(data.get("contracts"), dict) else None
    if not isinstance(v2, dict):
        errors.append("10.json has no contracts.vaultRegistryV2")
        return errors
    block = v2.get("deployBlock")
    if not isinstance(block, int) or isinstance(block, bool) or block <= 0:
        errors.append("10.json's contracts.vaultRegistryV2 has no deployBlock (> 0)")
        return errors
    expected = deployments.parse_record(data)[1]
    want = [(s.version, s.address, s.deploy_block, s.abi_kind) for s in expected]
    have = [(s.version, s.address, s.deploy_block, s.abi_kind) for s in preset.registries]
    if have != want:
        lines = ",\n".join(f"RegistrySpec({s.version}, {s.address!r}, {s.deploy_block})" for s in expected)
        errors.append(
            f"{preset.name}: built-in registries differ from contracts/deployments/10.json; use:\n{lines}"
        )
    return errors


def fixture_record(**top: Any) -> dict[str, Any]:
    return {
        "chainId": 10,
        "contracts": {
            "vaultRegistryV2": {"address": FIXTURE_V2, "deployBlock": FIXTURE_BLOCK, "abiHash": V2_HASH},
            "wallets": {"cryoshield.app": {"factory": "0x" + "fa" * 20, "implementation": "0x" + "1a" * 20}},
        },
        **top,
    }


def preset_with(*registries: RegistrySpec) -> NetworkPreset:
    p = NETWORKS["op-mainnet"]
    return NetworkPreset(p.name, p.chain_id, registries, p.rpcs)


# ------------------------------------------------------------------ the real preset vs the real record
def test_op_mainnet_preset_matches_its_record() -> None:
    """Passes with no 10.json (preset empty: lookup off); bites in 7.3 until the preset is regenerated."""
    data = json.loads(MAINNET_RECORD.read_text(encoding="utf-8")) if MAINNET_RECORD.exists() else None
    errors = mainnet_parity_errors(NETWORKS["op-mainnet"], data)
    assert not errors, "\n".join(errors)


def test_op_mainnet_never_has_a_v1_registry() -> None:
    assert not any(s.version == 1 for s in NETWORKS["op-mainnet"].registries)


# ------------------------------------------------------------------ the check itself (fixture records)
def test_parity_bites_when_the_record_arrives_before_the_preset() -> None:
    """What 7.3 sees if 10.json is committed without regenerating the preset."""
    errors = mainnet_parity_errors(preset_with(), fixture_record())
    assert len(errors) == 1
    assert f"RegistrySpec(2, '{FIXTURE_V2}', {FIXTURE_BLOCK})" in errors[0]


def test_parity_passes_for_a_regenerated_preset() -> None:
    assert (
        mainnet_parity_errors(preset_with(RegistrySpec(2, FIXTURE_V2, FIXTURE_BLOCK)), fixture_record()) == []
    )


def test_parity_refuses_a_wrong_address_or_block() -> None:
    assert mainnet_parity_errors(
        preset_with(RegistrySpec(2, "0x" + "2b" * 20, FIXTURE_BLOCK)), fixture_record()
    )
    assert mainnet_parity_errors(
        preset_with(RegistrySpec(2, FIXTURE_V2, FIXTURE_BLOCK + 1)), fixture_record()
    )


def test_parity_refuses_a_v1_registry_in_the_preset_or_record() -> None:
    v1 = RegistrySpec(1, "0x" + "b1" * 20, 1)
    errors = mainnet_parity_errors(
        preset_with(RegistrySpec(2, FIXTURE_V2, FIXTURE_BLOCK), v1), fixture_record()
    )
    assert any("v1 is never deployed" in e for e in errors)
    errors = mainnet_parity_errors(
        preset_with(RegistrySpec(2, FIXTURE_V2, FIXTURE_BLOCK)),
        fixture_record(address="0x" + "b1" * 20, deployBlock=1, abiHash=V1_HASH),
    )
    assert any("top-level (VaultRegistry v1) address" in e for e in errors)


def test_parity_refuses_registries_without_a_record() -> None:
    errors = mainnet_parity_errors(preset_with(RegistrySpec(2, FIXTURE_V2, FIXTURE_BLOCK)), None)
    assert any("does not exist" in e for e in errors)


def test_parity_refuses_a_record_without_v2_or_its_block() -> None:
    no_v2 = fixture_record()
    del no_v2["contracts"]["vaultRegistryV2"]
    assert any("no contracts.vaultRegistryV2" in e for e in mainnet_parity_errors(preset_with(), no_v2))
    no_block = fixture_record()
    del no_block["contracts"]["vaultRegistryV2"]["deployBlock"]
    assert any("no deployBlock" in e for e in mainnet_parity_errors(preset_with(), no_block))
    wrong_chain = fixture_record(chainId=11155420)
    assert any("not 10" in e for e in mainnet_parity_errors(preset_with(), wrong_chain))

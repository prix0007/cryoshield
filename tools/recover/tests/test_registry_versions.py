"""Registry versions as an ordered list (OpenSpec change recover-registry-versions, tasks 1.1-2.2).

The model (``RegistrySpec``), the ``--registry`` grammar, merge rules, ABI-kind resolution (D6), the
deployment-record / release-file parser (D5, D8) and the preset-vs-record parity test (D4).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from support.vectors import REPO_ROOT

from cryoshield_recover import config, deployments
from cryoshield_recover.config import (
    ABI_HASHES,
    MAX_REGISTRIES,
    NETWORKS,
    RegistryFlag,
    RegistrySpec,
    UnknownRegistryVersion,
    abi_kind_for,
    combine_registries,
    parse_registry_flag,
    resolve_flags,
    sort_registries,
)
from cryoshield_recover.keccak import keccak256

DEPLOYMENTS = REPO_ROOT / "contracts" / "deployments"
ABI_DIR = REPO_ROOT / "contracts" / "abi"
A1 = "0x" + "a1" * 20
A2 = "0x" + "a2" * 20
A3 = "0x" + "a3" * 20
V1_HASH = "0x978e16a51813cacf2f723f72db77d1e10c186e489ccf4cca8ec8bb4517cd0a07"
V2_HASH = "0xacb135ccf895846a59981b20545041660e21942c6108c000d9f1c46f552cb95c"
UNKNOWN_HASH = "0x" + "77" * 32


def specs_key(specs: list[RegistrySpec]) -> list[tuple[int, str, int, int]]:
    return [(s.version, s.address, s.deploy_block, s.abi_kind) for s in specs]


# ------------------------------------------------------------------ 1.1 grammar
@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (A1, RegistryFlag(A1, None, None, None)),
        (A1.upper().replace("0X", "0x") + "@0", RegistryFlag(A1, 0, None, None)),
        (A1 + ":v2", RegistryFlag(A1, None, 2, None)),
        (A1 + "@49755277:v2", RegistryFlag(A1, 49755277, 2, None)),
        (A1 + "@5:v3:abi=v2", RegistryFlag(A1, 5, 3, 2)),
        (A1 + ":v999:abi=v1", RegistryFlag(A1, None, 999, 1)),
    ],
)
def test_parse_registry_flag_accepts(text: str, expected: RegistryFlag) -> None:
    assert parse_registry_flag(text) == expected


FORM = "Expected --registry ADDRESS[@DEPLOY_BLOCK][:vN[:abi=vK]]"


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("0x1234", FORM),
        (A1 + "@-5", FORM),
        (A1 + "@0x10", FORM),
        (A1 + "@" + "9" * 19 + "0", FORM),  # far above 2**63: 20 digits
        (A1 + "@" + str(2**63), "too large"),
        (A1 + ":v0", FORM),
        (A1 + ":v01", FORM),
        (A1 + ":v1000", FORM),
        (A1 + ":2", FORM),
        (A1 + ":v2:abi=v1", "always uses the v2 ABI"),  # a known version has its own ABI
        (A1 + ":v1:abi=v2", "always uses the v1 ABI"),
        (A1 + ":v3:abi=v3", "unknown ABI kind abi=v3"),  # no such ABI kind
        (A1 + ":v3:abi=v0", "unknown ABI kind abi=v0"),
        (A1 + ":abi=v2", FORM),
        (A1 + "@5@6", FORM),
        (A1 + " :v2", FORM),
        (A1 + ":v2\n", FORM),  # "$" would accept a trailing newline; fullmatch does not
        (A1 + "\n", FORM),
        ("", FORM),
    ],
)
def test_parse_registry_flag_rejects(text: str, message: str) -> None:
    with pytest.raises(ValueError) as ei:
        parse_registry_flag(text)
    assert message in str(ei.value)


def test_addresses_and_ids_refuse_a_trailing_newline() -> None:
    with pytest.raises(ValueError):
        config.parse_address(A1 + "\n")
    with pytest.raises(ValueError):
        config.parse_bytes32("11" * 32 + "\n")
    with pytest.raises(ValueError):
        RegistrySpec(1, A1 + "\n")


def test_unknown_version_without_abi_is_refused_with_update_hint() -> None:
    with pytest.raises(UnknownRegistryVersion) as ei:
        parse_registry_flag(A3 + "@1:v3")
    msg = str(ei.value)
    assert "doesn't know registry v3" in msg and "update cryoshield-recover" in msg
    assert ":v3:abi=v2" in msg  # how to override when the user knows better
    assert isinstance(ei.value, ValueError)


def test_registry_spec_validates() -> None:
    assert RegistrySpec(2, A2, 7).abi_kind == 2
    assert RegistrySpec(1, A1.upper().replace("0X", "0x")).address == A1
    for bad in (
        lambda: RegistrySpec(0, A1),
        lambda: RegistrySpec(1, "0x12"),
        lambda: RegistrySpec(1, A1, -1),
        lambda: RegistrySpec(1, A1, 2**63),
        lambda: RegistrySpec(3, A3),  # unknown version, no ABI kind
        lambda: RegistrySpec(2, A2, abi_kind=1),
        lambda: RegistrySpec(3, A3, abi_kind=4),
    ):
        with pytest.raises(ValueError):
            bad()
    assert RegistrySpec(3, A3, abi_kind=2).abi_kind == 2
    assert RegistrySpec(3, A3, abi_kind=2).name == "v3"


def test_abi_kind_for() -> None:
    assert abi_kind_for(1) == 1 and abi_kind_for(2) == 2
    assert abi_kind_for(2, abi_hash=V2_HASH) == 2
    assert abi_kind_for(3, abi_hash=V2_HASH) == 2  # byte-identical ABI: not a guess
    assert abi_kind_for(3, abi_hash=V2_HASH.upper().replace("0X", "0x")) == 2
    assert abi_kind_for(4, abi_hash=V1_HASH) == 1
    assert abi_kind_for(3, explicit=2) == 2
    with pytest.raises(UnknownRegistryVersion):
        abi_kind_for(3, abi_hash=UNKNOWN_HASH)
    with pytest.raises(UnknownRegistryVersion):
        abi_kind_for(3)
    with pytest.raises(ValueError):
        abi_kind_for(2, abi_hash=V1_HASH)  # a v2 entry claiming v1's ABI is inconsistent
    assert abi_kind_for(2, abi_hash=UNKNOWN_HASH) == 2  # a known version keeps its own ABI


def test_sort_registries_newest_first_unique_and_bounded() -> None:
    out = sort_registries([RegistrySpec(1, A1), RegistrySpec(3, A3, abi_kind=2), RegistrySpec(2, A2)])
    assert [s.version for s in out] == [3, 2, 1]
    mixed = sort_registries([RegistrySpec(9, A3, abi_kind=2, trusted=False), RegistrySpec(1, A1)])
    assert [s.version for s in mixed] == [1, 9]  # untrusted after every trusted entry
    with pytest.raises(ValueError, match="twice"):
        sort_registries([RegistrySpec(2, A1), RegistrySpec(2, A2)])
    with pytest.raises(ValueError, match="twice"):
        sort_registries([RegistrySpec(1, A1), RegistrySpec(2, A1)])
    many = [RegistrySpec(n, "0x" + f"{n:040x}", abi_kind=2) for n in range(2, 3 + MAX_REGISTRIES)]
    with pytest.raises(ValueError, match="at most"):
        sort_registries(many)


# ------------------------------------------------------------------ 1.1 flags and trust (D7, D10, D11)
BUILTIN = [RegistrySpec(2, A2, 200), RegistrySpec(1, A1, 100)]


def flags(*texts: str) -> tuple[list[RegistrySpec], list[str]]:
    return resolve_flags(BUILTIN, [parse_registry_flag(t) for t in texts])


def combine(*texts: str, only: bool = False, trust: bool = False, builtin: Any = None) -> list[RegistrySpec]:
    base = BUILTIN if builtin is None else builtin
    supplied = resolve_flags(base, [parse_registry_flag(t) for t in texts])[0]
    return combine_registries(base, supplied, only=only, trust_custom=trust)


def trust_key(specs: list[RegistrySpec]) -> list[tuple[int, str, int, bool]]:
    return [(s.version, s.address, s.deploy_block, s.trusted) for s in specs]


def test_supplied_newer_version_ranks_below_every_built_in() -> None:
    """HIGH 1: a phished --registry …:v99:abi=v2 must never outrank the built-in registries."""
    out = combine(A3 + "@500:v99:abi=v2")
    assert trust_key(out) == [(2, A2, 200, True), (1, A1, 100, True), (99, A3, 500, False)]
    assert out[2].source == "--registry" and out[2].label == "v99 (supplied)"


def test_supplied_same_version_is_added_beside_the_built_in() -> None:
    """MEDIUM (M3): --registry X:v1 keeps the built-in v1 too, so a genuine v1 vault is never hidden."""
    other = "0x" + "b1" * 20
    out = combine(other + "@5:v1")
    assert trust_key(out) == [(2, A2, 200, True), (1, A1, 100, True), (1, other, 5, False)]


def test_exact_built_in_entry_is_built_in() -> None:
    """M2: a supplied entry equal to a built-in one IS the built-in one (no warning)."""
    assert combine(A2 + "@200:v2") == BUILTIN
    assert combine(A2 + ":v2") == BUILTIN


def test_lower_built_in_block_is_allowed_and_stays_trusted() -> None:
    out = combine(A2 + "@150:v2")
    assert trust_key(out)[0] == (2, A2, 150, True) and out[0].source == "built-in"


def test_raised_built_in_block_is_refused() -> None:
    """HIGH 2: a later start block could hide the genuine vault's first events."""
    with pytest.raises(ValueError, match="block 200"):
        combine(A2 + "@201:v2")


def test_registries_only_uses_just_the_supplied_entries() -> None:
    out = combine(A3 + "@1:v3:abi=v2", only=True)
    assert trust_key(out) == [(3, A3, 1, False)]


def test_no_built_in_registry_means_supplied_is_trusted() -> None:
    out = combine(A3 + "@1:v3:abi=v2", A2 + "@2:v2", builtin=[])
    assert trust_key(out) == [(3, A3, 1, True), (2, A2, 2, True)]


def test_trust_custom_ranks_supplied_by_version() -> None:
    out = combine(A3 + "@1:v3:abi=v2", trust=True)
    assert trust_key(out) == [(3, A3, 1, True), (2, A2, 200, True), (1, A1, 100, True)]
    with pytest.raises(ValueError, match="--registries-only"):
        combine("0x" + "b2" * 20 + "@1:v2", trust=True)


def test_supplied_entries_are_capped() -> None:
    texts = [f"0x{n:040x}@1:v{n}:abi=v2" for n in range(3, 4 + config.MAX_SUPPLIED)]
    with pytest.raises(ValueError, match="at most"):
        combine(*texts)


def test_bare_known_address_gets_its_version_with_a_note() -> None:
    out, notes = flags(A2)
    assert [(s.version, s.address, s.deploy_block) for s in out] == [(2, A2, 200)]
    assert len(notes) == 1 and ":v2" in notes[0] and "known registry v2" in notes[0]


def test_bare_unknown_address_means_v1_with_a_note() -> None:
    other = "0x" + "c1" * 20
    out, notes = flags(other + "@9")
    assert [(s.version, s.address, s.deploy_block) for s in out] == [(1, other, 9)]
    assert len(notes) == 1 and ":v2" in notes[0] and "v1" in notes[0]


def test_flag_without_block_scans_from_zero() -> None:
    out, _ = flags("0x" + "b2" * 20 + ":v2")
    assert out[0].deploy_block == 0 and out[0].block_known is False


def test_flags_refuse_duplicates() -> None:
    with pytest.raises(ValueError, match="twice"):
        flags(A3 + ":v2", "0x" + "d2" * 20 + ":v2")
    with pytest.raises(ValueError, match="twice"):
        combine(A1 + "@1:v3:abi=v2")  # A1 is the built-in v1's address


def test_flag_keeps_a_known_entry_s_abi_kind() -> None:
    known = [RegistrySpec(3, A3, 50, abi_kind=2, source="from x", trusted=False)]
    out, _ = resolve_flags(known, [parse_registry_flag(A3)])
    assert specs_key(out) == [(3, A3, 50, 2)]


# ------------------------------------------------------------------ 1.2 pins and presets
def test_pinned_abi_hashes_match_the_exported_abis() -> None:
    assert ABI_HASHES == {
        "0x" + keccak256((ABI_DIR / "VaultRegistry.json").read_bytes()).hex(): 1,
        "0x" + keccak256((ABI_DIR / "VaultRegistryV2.json").read_bytes()).hex(): 2,
    }


def test_presets_are_ordered_unique_and_bounded() -> None:
    for name, p in NETWORKS.items():
        assert list(p.registries) == sort_registries(list(p.registries)), name
        assert len(p.registries) <= MAX_REGISTRIES
        assert all(s.source == "built-in" and s.block_known for s in p.registries), name


def test_op_sepolia_lists_v2_then_v1() -> None:
    assert specs_key(list(NETWORKS["op-sepolia"].registries)) == [
        (2, "0xa622c92d3d5b54aea081cf410224a8a2ecb08cb7", 49755277, 2),
        (1, "0xb43f58cf17e64b603ae5588a1dd17e96a0849e44", 49568053, 1),
    ]


# ------------------------------------------------------------------ 2.1 records and release files
def record(**contracts: Any) -> dict[str, Any]:
    return {
        "chainId": 10,
        "contracts": {"vaultRegistryV2": {"address": A2, "deployBlock": 20, "abiHash": V2_HASH}, **contracts},
    }


def test_parse_real_records() -> None:
    chain_id, specs = deployments.parse_record(json.loads((DEPLOYMENTS / "11155420.json").read_text()))
    assert chain_id == 11155420
    assert specs_key(specs) == specs_key(list(NETWORKS["op-sepolia"].registries))
    chain_id, specs = deployments.parse_record(json.loads((DEPLOYMENTS / "31337.json").read_text()))
    assert chain_id == 31337 and [s.version for s in specs] == [2, 1]


def test_v2_only_record() -> None:
    chain_id, specs = deployments.parse_record(record())
    assert chain_id == 10 and specs_key(specs) == [(2, A2, 20, 2)]


@pytest.mark.parametrize(
    "contracts",
    [
        {"vaultRegistries": {"v3": {"address": A3, "deployBlock": 30, "abiHash": V2_HASH}}},
        {"vaultRegistryV3": {"address": A3, "deployBlock": 30, "abiHash": V2_HASH}},
        {  # both keys, identical: fine
            "vaultRegistries": {"v3": {"address": A3, "deployBlock": 30, "abiHash": V2_HASH}},
            "vaultRegistryV3": {"address": A3, "deployBlock": 30, "abiHash": V2_HASH},
        },
    ],
)
def test_forward_compatible_record_keys(contracts: dict[str, Any]) -> None:
    _, specs = deployments.parse_record(record(**contracts))
    assert specs_key(specs) == [(3, A3, 30, 2), (2, A2, 20, 2)]
    assert all(s.source == "built-in" for s in specs)


@pytest.mark.parametrize(
    ("contracts", "needle"),
    [
        ({"vaultRegistries": {"v3": {"address": A3, "deployBlock": 1, "abiHash": UNKNOWN_HASH}}}, "v3"),
        ({"vaultRegistries": {"v3": {"address": A3, "deployBlock": 1}}}, "v3"),  # no abiHash
        (
            {
                "vaultRegistries": {"v3": {"address": A3, "deployBlock": 1, "abiHash": V2_HASH}},
                "vaultRegistryV3": {"address": A1, "deployBlock": 1, "abiHash": V2_HASH},
            },
            "twice",
        ),
        ({"vaultRegistries": {"v3": {"address": A2, "deployBlock": 1, "abiHash": V2_HASH}}}, "twice"),
        ({"vaultRegistries": {"v3": "0x" + "a3" * 20}}, "object"),
        ({"vaultRegistries": {"three": {"address": A3}}}, "three"),
        ({"vaultRegistries": {"v03": {"address": A3}}}, "v03"),
        ({"vaultRegistries": ["v3"]}, "vaultRegistries"),
        ({"vaultRegistries": {"v3": {"address": "0x12", "abiHash": V2_HASH}}}, "address"),
        ({"vaultRegistries": {"v3": {"address": A3, "deployBlock": -1, "abiHash": V2_HASH}}}, "deployBlock"),
        (
            {"vaultRegistries": {"v3": {"address": A3, "deployBlock": True, "abiHash": V2_HASH}}},
            "deployBlock",
        ),
        ({"vaultRegistries": {"v3": {"address": A3, "deployBlock": "5", "abiHash": V2_HASH}}}, "deployBlock"),
        ({"vaultRegistries": {"v3": {"address": A3, "abiHash": 5}}}, "abiHash"),
    ],
)
def test_bad_record_entries_are_refused(contracts: dict[str, Any], needle: str) -> None:
    with pytest.raises(ValueError) as ei:
        deployments.parse_record(record(**contracts))
    assert needle in str(ei.value)


def test_missing_deploy_block_means_zero_unknown() -> None:
    _, specs = deployments.parse_record({"chainId": 10, "contracts": {"vaultRegistryV2": {"address": A2}}})
    assert specs[0].deploy_block == 0 and specs[0].block_known is False


@pytest.mark.parametrize(
    "doc",
    [
        {"chainId": 10},
        {"chainId": 10, "contracts": {}},
        {"chainId": "10", "contracts": {"vaultRegistryV2": {"address": A2}}},
        {"chainId": 0, "contracts": {"vaultRegistryV2": {"address": A2}}},
        {"chainId": True, "contracts": {"vaultRegistryV2": {"address": A2}}},
        {"contracts": {"vaultRegistryV2": {"address": A2}}},
        {"chainId": 10, "contracts": "x"},
        [],
    ],
)
def test_bad_documents_are_refused(doc: Any) -> None:
    with pytest.raises(ValueError):
        deployments.parse_document(doc, source="x")


def release(**cfg: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "chainId": 11155420,
        "rpId": "cryoshield.app",
        "registry": {"address": A1, "deployBlock": 10},
        "registryV2": {"address": A2, "deployBlock": 20},
        "wallet": {"factory": "0x" + "ff" * 20},
    }
    base.update(cfg)
    return {"name": "cryoshield-web", "commit": "0" * 40, "config": base}


def test_release_file_parses_like_a_record() -> None:
    chain_id, specs = deployments.parse_document(release(), source="from release.json")
    assert chain_id == 11155420
    assert specs_key(specs) == [(2, A2, 20, 2), (1, A1, 10, 1)]
    assert all(s.source == "from release.json" for s in specs)
    _, specs = deployments.parse_document(release(registry=None), source="x")
    assert [s.version for s in specs] == [2]
    _, specs = deployments.parse_document(
        release(registries=[{"version": "v3", "address": A3, "deployBlock": 30, "abiHash": V2_HASH}]),
        source="x",
    )
    assert specs_key(specs) == [(3, A3, 30, 2), (2, A2, 20, 2), (1, A1, 10, 1)]
    with pytest.raises(UnknownRegistryVersion):
        deployments.parse_document(
            release(registries=[{"version": "v3", "address": A3, "deployBlock": 30}]), source="x"
        )
    with pytest.raises(ValueError):
        deployments.parse_document(release(registries={"v3": {}}), source="x")


def test_load_file_limits_and_errors(tmp_path: Path) -> None:
    good = tmp_path / "11155420.json"
    good.write_text(json.dumps(record()))
    chain_id, specs = deployments.load_file(good)
    assert chain_id == 10 and specs[0].source == "from '11155420.json'" and not specs[0].trusted
    big = tmp_path / "big.json"
    big.write_bytes(b" " * (deployments.MAX_FILE_BYTES + 1))
    with pytest.raises(ValueError, match="larger"):
        deployments.load_file(big)
    bad = tmp_path / "bad.json"
    bad.write_text("{not json")
    with pytest.raises(ValueError, match="JSON"):
        deployments.load_file(bad)
    with pytest.raises(ValueError, match="read"):
        deployments.load_file(tmp_path / "missing.json")


def test_load_file_refuses_duplicate_keys(tmp_path: Path) -> None:
    p = tmp_path / "dup.json"
    p.write_text(
        '{"chainId": 10, "chainId": 11155420, "contracts": {"vaultRegistryV2": {"address": "' + A2 + '"}}}'
    )
    with pytest.raises(ValueError, match="twice"):
        deployments.load_file(p)


def test_load_file_refuses_deep_nesting(tmp_path: Path) -> None:
    p = tmp_path / "deep.json"
    p.write_text("[" * 200_000 + "]" * 200_000)
    with pytest.raises(ValueError, match="nested too deeply"):
        deployments.load_file(p)


def test_file_names_are_inert(tmp_path: Path) -> None:
    p = tmp_path / "evil\x1b[31m\u202e.json"
    p.write_text(json.dumps(record()))
    _, specs = deployments.load_file(p)
    assert "\x1b" not in specs[0].source and "\u202e" not in specs[0].source
    assert specs[0].source == "from 'evil[31m.json'"


def test_read_error_without_strerror(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import builtins

    def boom(*_a: Any, **_k: Any) -> Any:
        raise OSError()

    monkeypatch.setattr(builtins, "open", boom)
    with pytest.raises(ValueError, match="OSError"):
        deployments.load_file(tmp_path / "x.json")


@pytest.mark.parametrize(
    "doc",
    [
        {"chainId": 10, "contracts": {"vaultRegistries": {"v3\n": {"address": A3, "abiHash": V2_HASH}}}},
        {"chainId": 10, "contracts": {"vaultRegistryV2": {"address": A2 + "\n"}}},
        {"chainId": 10, "contracts": {"vaultRegistryV2": {"address": A2, "abiHash": V2_HASH + "\n"}}},
        {"chainId": 10, "contracts": {"vaultRegistryV2\n": {"address": A2}}},  # not a registry key at all
        {"config": {"chainId": 10, "registryV2\n": {"address": A2}}},
    ],
)
def test_file_values_refuse_a_trailing_newline(doc: Any) -> None:
    with pytest.raises(ValueError):
        deployments.parse_document(doc, source="x")


# ------------------------------------------------------------------ 2.2 parity (D4)
def parity_errors(preset: config.NetworkPreset, data: dict[str, Any] | None) -> list[str]:
    """Differences between a preset's registry list and its chain's deployment record."""
    expected = deployments.parse_record(data)[1] if data else []
    if specs_key(list(preset.registries)) == specs_key(expected):
        return []
    lines = ",\n".join(
        f"RegistrySpec({s.version}, {s.address!r}, {s.deploy_block}, abi_kind={s.abi_kind})" for s in expected
    )
    return [f"{preset.name}: built-in registries differ from the deployment record; use:\n{lines}"]


def test_presets_match_deployment_records() -> None:
    """Every preset's list equals its record's (both directions); every record has a preset."""
    errors: list[str] = []
    for p in NETWORKS.values():
        path = DEPLOYMENTS / f"{p.chain_id}.json"
        errors += parity_errors(p, json.loads(path.read_text()) if path.exists() else None)
    assert not errors, "\n".join(errors)
    preset_chains = {p.chain_id for p in NETWORKS.values()}
    for path in DEPLOYMENTS.glob("*.json"):
        assert int(path.stem) in preset_chains, f"{path.name} has no network preset"


def test_parity_fails_when_a_record_gains_a_version() -> None:
    data = json.loads((DEPLOYMENTS / "11155420.json").read_text())
    data["contracts"]["vaultRegistries"] = {"v3": {"address": A3, "deployBlock": 1, "abiHash": V2_HASH}}
    errors = parity_errors(NETWORKS["op-sepolia"], data)
    assert errors and "RegistrySpec(3, " in errors[0]


def test_parity_fails_when_a_record_has_an_unreadable_version() -> None:
    data = json.loads((DEPLOYMENTS / "11155420.json").read_text())
    data["contracts"]["vaultRegistries"] = {"v3": {"address": A3, "deployBlock": 1, "abiHash": UNKNOWN_HASH}}
    with pytest.raises(UnknownRegistryVersion):
        parity_errors(NETWORKS["op-sepolia"], data)

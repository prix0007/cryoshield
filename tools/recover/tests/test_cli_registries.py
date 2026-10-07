"""Registry configuration on the command line (OpenSpec change recover-registry-versions, task 4.1).

``--registry ADDRESS[@DEPLOY_BLOCK][:vN[:abi=vK]]`` (merge by version, or ``--registries-only``),
``--deployment-file``, the deprecated aliases, and the startup summary (design D7-D9).
"""

from __future__ import annotations

import io
import json
from pathlib import Path
from typing import Any

import pytest
from support.fakes import FakeChain
from support.keys import FakePrfSource, PhysicalKey
from support.vectors import REPO_ROOT

from cryoshield_recover import cli, config
from cryoshield_recover.config import NETWORKS
from cryoshield_recover.errors import ExitCode, RecoveryError
from cryoshield_recover.ui import Console

SEPOLIA = list(NETWORKS["op-sepolia"].registries)
V2_ADDR, V1_ADDR = SEPOLIA[0].address, SEPOLIA[1].address
A3 = "0x" + "a3" * 20
B2 = "0x" + "b2" * 20
V2_HASH = "0xacb135ccf895846a59981b20545041660e21942c6108c000d9f1c46f552cb95c"
RECORD = REPO_ROOT / "contracts" / "deployments" / "11155420.json"


def cfg(*argv: str) -> config.Config:
    return cli.config_from_args(cli.build_parser().parse_args(list(argv)))


def usage(*argv: str) -> str:
    with pytest.raises(RecoveryError) as ei:
        cfg(*argv)
    assert ei.value.exit_code == ExitCode.USAGE
    return ei.value.message


def key(c: config.Config) -> list[tuple[int, str, int, int, str]]:
    return [(s.version, s.address, s.deploy_block, s.abi_kind, s.source) for s in c.registries]


def summary(c: config.Config) -> str:
    err = io.StringIO()
    ui = Console(io.StringIO(), io.StringIO(), err, getpass_fn=lambda _p: "1", interactive=True)
    cli.startup_summary(c, ui)
    return err.getvalue()


def write(tmp_path: Path, name: str, doc: Any) -> str:
    p = tmp_path / name
    p.write_text(json.dumps(doc))
    return str(p)


# ------------------------------------------------------------------ --registry
def test_defaults_are_the_preset_list() -> None:
    c = cfg()
    assert c.registries == SEPOLIA and c.notes == [] and c.dropped_builtin == []


def test_add_a_newer_version() -> None:
    c = cfg("--registry", f"{A3}@500:v3:abi=v2")
    assert key(c) == [
        (3, A3, 500, 2, "--registry"),
        (2, V2_ADDR, 49755277, 2, "built-in"),
        (1, V1_ADDR, 49568053, 1, "built-in"),
    ]


def test_replace_one_version_without_block_scans_from_zero() -> None:
    c = cfg("--registry", f"{B2}:v2")
    assert key(c)[0] == (2, B2, 0, 2, "--registry") and c.registries[1] == SEPOLIA[1]
    text = summary(c)
    assert "block 0" in text and f"{B2}@BLOCK:v2" in text


def test_repeatable_and_ordered_newest_first() -> None:
    c = cfg("--registry", f"{B2}@9:v2", "--registry", f"{A3}@10:v3:abi=v2")
    assert [s.version for s in c.registries] == [3, 2, 1]


def test_registries_only() -> None:
    c = cfg("--registries-only", "--registry", f"{B2}@7:v2")
    assert key(c) == [(2, B2, 7, 2, "--registry")]
    assert c.dropped_builtin == [2, 1]
    text = summary(c)
    assert "v2" in text and "v1" in text and "not used" in text


def test_registries_only_needs_a_registry_and_excludes_a_file(tmp_path: Path) -> None:
    assert "--registries-only" in usage("--registries-only")
    f = write(tmp_path, "r.json", json.loads(RECORD.read_text()))
    assert "--registries-only" in usage(
        "--registries-only", "--registry", f"{B2}@7:v2", "--deployment-file", f
    )


def test_bare_address_is_v1_with_a_note() -> None:
    c = cfg("--registry", "0x" + "c1" * 20)
    assert key(c)[1] == (1, "0x" + "c1" * 20, 0, 1, "--registry")
    assert len(c.notes) == 1 and ":v2" in c.notes[0]
    assert c.notes[0] in summary(c)


def test_bare_known_address_keeps_its_version() -> None:
    c = cfg("--registry", V2_ADDR)
    assert c.registries == SEPOLIA and c.notes == []


@pytest.mark.parametrize(
    "value", ["0x1234", f"{A3}@-1:v3:abi=v2", f"{A3}:v0", f"{B2}:v2:abi=v1", f"{A3}:v3:abi=v7"]
)
def test_bad_registry_values_are_usage_errors(value: str) -> None:
    usage("--registry", value)


def test_same_version_twice_is_refused() -> None:
    assert "twice" in usage("--registry", f"{B2}:v2", "--registry", f"{A3}:v2")


def test_unknown_version_refused_before_any_request() -> None:
    with FakeChain() as node:
        err = io.StringIO()
        ui = Console(io.StringIO("no\n"), io.StringIO(), err, getpass_fn=lambda _p: "1", interactive=True)
        code = cli.main(
            ["--rpc", node.url, "--registry", f"{A3}@1:v3", "--no-arweave"],
            console=ui,
            prf_factory=lambda u: FakePrfSource([PhysicalKey.named("A")], ui=u),
        )
        requests = list(node.requests)
    assert code == ExitCode.USAGE
    assert "doesn't know registry v3" in err.getvalue() and "update cryoshield-recover" in err.getvalue()
    assert requests == []


# ------------------------------------------------------------------ deprecated aliases
def test_registry_v2_alias() -> None:
    c = cfg("--registry-v2", B2, "--deploy-block-v2", "1")
    assert key(c)[0] == (2, B2, 1, 2, "--registry") and c.registries[1] == SEPOLIA[1]
    assert any("deprecated" in n and f"--registry {B2}@1:v2" in n for n in c.notes)


def test_deploy_block_aliases_change_the_final_entry() -> None:
    c = cfg("--deploy-block-v2", "7", "--deploy-block", "5")
    assert key(c) == [(2, V2_ADDR, 7, 2, "--registry"), (1, V1_ADDR, 5, 1, "--registry")]
    assert sum("deprecated" in n for n in c.notes) == 2


def test_deploy_block_without_that_version_is_refused() -> None:
    assert "v1" in usage("--network", "op-mainnet", "--registry", f"{B2}@3:v2", "--deploy-block", "5")
    assert "v2" in usage(
        "--registries-only", "--registry", "0x" + "c1" * 20 + "@1:v1", "--deploy-block-v2", "5"
    )
    usage("--deploy-block", "-1")


# ------------------------------------------------------------------ --deployment-file
def test_deployment_record_selects_its_chain(tmp_path: Path) -> None:
    f = write(tmp_path, "11155420.json", json.loads(RECORD.read_text()))
    c = cfg("--deployment-file", f)
    assert c.network == "op-sepolia" and c.rpcs == list(NETWORKS["op-sepolia"].rpcs)
    assert [(s.version, s.address, s.deploy_block) for s in c.registries] == [
        (s.version, s.address, s.deploy_block) for s in SEPOLIA
    ]
    assert {s.source for s in c.registries} == {"from 11155420.json"}
    assert "from 11155420.json" in summary(c)


def test_deployment_file_with_a_new_version_and_a_flag_on_top(tmp_path: Path) -> None:
    doc = json.loads(RECORD.read_text())
    doc["contracts"]["vaultRegistries"] = {"v3": {"address": A3, "deployBlock": 60, "abiHash": V2_HASH}}
    f = write(tmp_path, "next.json", doc)
    c = cfg("--deployment-file", f, "--registry", f"{B2}@9:v2")
    assert [(s.version, s.address, s.source) for s in c.registries] == [
        (3, A3, "from next.json"),
        (2, B2, "--registry"),
        (1, V1_ADDR, "from next.json"),
    ]


def test_release_file_is_accepted(tmp_path: Path) -> None:
    doc = {
        "name": "cryoshield-web",
        "config": {"chainId": 10, "registry": None, "registryV2": {"address": B2, "deployBlock": 4}},
    }
    c = cfg("--deployment-file", write(tmp_path, "release.json", doc))
    assert c.network == "op-mainnet" and key(c) == [(2, B2, 4, 2, "from release.json")]


def test_deployment_file_chain_conflicts_are_refused(tmp_path: Path) -> None:
    f = write(tmp_path, "r.json", json.loads(RECORD.read_text()))
    assert "11155420" in usage("--deployment-file", f, "--network", "op-mainnet")
    assert "11155420" in usage("--deployment-file", f, "--chain-id", "10")
    assert cfg("--deployment-file", f, "--testnet").network == "op-sepolia"


def test_deployment_file_for_a_custom_chain_needs_rpc(tmp_path: Path) -> None:
    f = write(tmp_path, "777.json", {"chainId": 777, "contracts": {"vaultRegistryV2": {"address": B2}}})
    assert "--rpc" in usage("--deployment-file", f)
    c = cfg("--deployment-file", f, "--rpc", "https://node.example/rpc")
    assert c.network == "custom" and c.chain_id == 777
    assert key(c) == [(2, B2, 0, 2, "from 777.json")] and "block 0" in summary(c)


def test_deployment_file_dropping_a_built_in_version_is_announced(tmp_path: Path) -> None:
    doc = json.loads(RECORD.read_text())
    for k in ("address", "deployBlock", "abiHash", "txHash"):
        doc.pop(k)
    c = cfg("--deployment-file", write(tmp_path, "v2only.json", doc))
    assert [s.version for s in c.registries] == [2] and c.dropped_builtin == [1]


@pytest.mark.parametrize(
    "content",
    [
        "{oops",
        json.dumps({"chainId": 11155420}),
        json.dumps({"chainId": 11155420, "contracts": {"vaultRegistries": {"v4": {"address": A3}}}}),
        json.dumps({"hello": "world"}),
    ],
)
def test_bad_deployment_files_are_usage_errors(tmp_path: Path, content: str) -> None:
    p = tmp_path / "bad.json"
    p.write_text(content)
    usage("--deployment-file", str(p))
    usage("--deployment-file", str(tmp_path / "missing.json"))


# ------------------------------------------------------------------ startup summary (D9)
def test_summary_lists_registries_newest_first_with_sources() -> None:
    text = summary(cfg("--registry", f"{A3}@500:v3:abi=v2"))
    lines = [ln.strip() for ln in text.splitlines() if ln.strip().startswith("registry v")]
    assert lines == [
        f"registry v3 {A3} from block 500 (from --registry), read with the v2 ABI",
        f"registry v2 {V2_ADDR} from block 49755277 (built-in)",
        f"registry v1 {V1_ADDR} from block 49568053 (built-in)",
    ]
    assert "SECURITY" in text and "you supplied" in text


def test_summary_has_no_security_note_for_built_ins() -> None:
    text = summary(cfg())
    assert "SECURITY" not in text and "registry v2" in text


def test_summary_comes_before_any_request() -> None:
    with FakeChain() as node:
        node.enable_v2()
        err = io.StringIO()
        ui = Console(io.StringIO("no\n"), io.StringIO(), err, getpass_fn=lambda _p: "1", interactive=True)
        seen: list[int] = []

        def prf(u: Any) -> FakePrfSource:
            seen.append(len(node.requests))
            return FakePrfSource([PhysicalKey.named("A")], ui=u)

        cli.main(
            ["--rpc", node.url, "--registries-only", "--registry", f"{node.address}@0:v1", "--no-arweave"],
            console=ui,
            prf_factory=prf,
        )
    assert seen == [0] and f"registry v1 {node.address}" in err.getvalue()

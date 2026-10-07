"""Registry configuration on the command line (OpenSpec change recover-registry-versions, tasks 4.1, 9.x).

``--registry ADDRESS[@DEPLOY_BLOCK][:vN[:abi=vK]]``, ``--registries-only``, ``--deployment-file``,
``--trust-custom-registries``, the deprecated aliases, the startup summary, and the trust rules (D10,
D11): a supplied registry that differs from the built-ins is read AFTER them and never vouches for a copy.
"""

from __future__ import annotations

import io
import json
from pathlib import Path
from typing import Any

import pytest
from support import vectors
from support.fakes import FakeChain
from support.keys import BY_NAME, FakePrfSource, PhysicalKey
from support.vectors import REPO_ROOT, h

from cryoshield_recover import cli, config
from cryoshield_recover.config import NETWORKS
from cryoshield_recover.errors import ExitCode, RecoveryError
from cryoshield_recover.ui import Console

SEPOLIA = list(NETWORKS["op-sepolia"].registries)
V2_ADDR, V1_ADDR = SEPOLIA[0].address, SEPOLIA[1].address
ANVIL = list(NETWORKS["anvil"].registries)
A3 = "0x" + "a3" * 20
B2 = "0x" + "b2" * 20
V2_HASH = "0xacb135ccf895846a59981b20545041660e21942c6108c000d9f1c46f552cb95c"
RECORD = REPO_ROOT / "contracts" / "deployments" / "11155420.json"

V2V = {v["name"]: v for v in vectors.cases("vaults")}["any-of-2"]
BLOB, VID, SECRET = h(V2V["blob"]), h(V2V["vaultId"]), h(V2V["secret"])
UPDATE = vectors.cases("updatePayloadCases")[0]
NEW, NEW_SECRET = h(UPDATE["expectedBlob"]), h(UPDATE["newSecret"])
LOC_A, LOC_B = h(BY_NAME["A"]["locator"]), h(BY_NAME["B"]["locator"])


def cfg(*argv: str) -> config.Config:
    return cli.config_from_args(cli.build_parser().parse_args(list(argv)))


def usage(*argv: str) -> str:
    with pytest.raises(RecoveryError) as ei:
        cfg(*argv)
    assert ei.value.exit_code == ExitCode.USAGE
    return ei.value.message


def key(c: config.Config) -> list[tuple[int, str, int, bool, str]]:
    return [(s.version, s.address, s.deploy_block, s.trusted, s.source) for s in c.registries]


def summary(c: config.Config) -> str:
    err = io.StringIO()
    ui = Console(io.StringIO(), io.StringIO(), err, getpass_fn=lambda _p: "1", interactive=True)
    cli.startup_summary(c, ui)
    return err.getvalue()


def write(tmp_path: Path, name: str, doc: Any) -> str:
    p = tmp_path / name
    p.write_text(json.dumps(doc))
    return str(p)


BUILT = [(s.version, s.address, s.deploy_block, True, "built-in") for s in SEPOLIA]


# ------------------------------------------------------------------ --registry
def test_defaults_are_the_preset_list() -> None:
    c = cfg()
    assert c.registries == SEPOLIA and c.notes == [] and c.dropped_builtin == []


def test_a_newer_supplied_version_ranks_after_the_built_ins() -> None:
    c = cfg("--registry", f"{A3}@500:v3:abi=v2")
    assert key(c) == [*BUILT, (3, A3, 500, False, "--registry")]


def test_same_version_is_added_beside_the_built_in_and_scans_from_zero() -> None:
    c = cfg("--registry", f"{B2}:v2")
    assert key(c) == [*BUILT, (2, B2, 0, False, "--registry")]
    text = summary(c)
    assert "block 0" in text and f"{B2}@BLOCK:v2" in text


def test_v1_replacement_keeps_scanning_the_built_in_v1() -> None:
    """M3: a genuine v1 vault must not be hidden by --registry X:v1."""
    c = cfg("--registry", "0x" + "c1" * 20 + "@5:v1")
    assert key(c) == [*BUILT, (1, "0x" + "c1" * 20, 5, False, "--registry")]


def test_exact_built_in_entry_counts_as_built_in() -> None:
    assert cfg("--registry", f"{V2_ADDR}@49755277:v2").registries == SEPOLIA
    assert "SECURITY" not in summary(cfg("--registry", f"{V2_ADDR}@49755277:v2"))


def test_lower_built_in_block_is_fine_and_raised_is_refused() -> None:
    c = cfg("--registry", f"{V2_ADDR}@49000000:v2")
    assert key(c)[0] == (2, V2_ADDR, 49000000, True, "built-in")
    assert "49755277" in usage("--registry", f"{V2_ADDR}@49755278:v2")
    assert "49755277" in usage("--deploy-block-v2", "50000000")


def test_registries_only() -> None:
    c = cfg("--registries-only", "--registry", f"{B2}@7:v2")
    assert key(c) == [(2, B2, 7, False, "--registry")]
    assert c.dropped_builtin == [2, 1]
    text = summary(c)
    assert "v2, v1" in text and "not used" in text


def test_registries_only_needs_a_registry_or_a_file(tmp_path: Path) -> None:
    assert "--registries-only" in usage("--registries-only")
    f = write(tmp_path, "r.json", json.loads(RECORD.read_text()))
    c = cfg("--registries-only", "--deployment-file", f)
    assert [(s.version, s.trusted) for s in c.registries] == [(2, True), (1, True)]


def test_bare_unknown_address_is_v1_with_a_note() -> None:
    c = cfg("--registry", "0x" + "c1" * 20)
    assert key(c)[-1] == (1, "0x" + "c1" * 20, 0, False, "--registry")
    assert len(c.notes) == 1 and ":v2" in c.notes[0]
    assert c.notes[0] in summary(c)


def test_bare_known_address_is_that_built_in_with_a_note() -> None:
    c = cfg("--registry", V2_ADDR)
    assert c.registries == SEPOLIA
    assert len(c.notes) == 1 and "known registry v2" in c.notes[0]


@pytest.mark.parametrize(
    ("value", "message"),
    [
        ("0x1234", "Expected --registry"),
        (f"{A3}@-1:v3:abi=v2", "Expected --registry"),
        (f"{A3}:v0", "Expected --registry"),
        (f"{B2}:v2:abi=v1", "always uses the v2 ABI"),
        (f"{A3}:v3:abi=v7", "unknown ABI kind"),
        (f"{B2}:v2\n", "Expected --registry"),
    ],
)
def test_bad_registry_values_are_usage_errors(value: str, message: str) -> None:
    assert message in usage("--registry", value)


def test_same_version_twice_is_refused() -> None:
    assert "twice" in usage("--registry", f"{B2}:v2", "--registry", f"{A3}:v2")


def test_supplied_registries_are_capped() -> None:
    args: list[str] = []
    for n in range(3, 4 + config.MAX_SUPPLIED):
        args += ["--registry", f"0x{n:040x}@1:v{n}:abi=v2"]
    assert "at most" in usage(*args)


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


# ------------------------------------------------------------------ --trust-custom-registries
def test_trust_custom_registries_ranks_supplied_by_version() -> None:
    c = cfg("--trust-custom-registries", "--registry", f"{A3}@500:v3:abi=v2")
    assert key(c) == [(3, A3, 500, True, "--registry"), *BUILT]
    text = summary(c)
    assert "--trust-custom-registries is set" in text and "SECURITY" in text
    assert "--registries-only" in usage("--trust-custom-registries", "--registry", f"{B2}@1:v2")


# ------------------------------------------------------------------ deprecated aliases
def test_registry_v2_alias() -> None:
    c = cfg("--registry-v2", B2, "--deploy-block-v2", "1")
    assert key(c) == [*BUILT, (2, B2, 1, False, "--registry")]
    assert any("deprecated" in n and f"--registry {B2}@1:v2" in n for n in c.notes)


def test_registry_v2_errors_name_the_flag() -> None:
    assert "--registry-v2" in usage("--registry-v2", "0x1234")


def test_deploy_block_aliases_lower_the_built_in_blocks() -> None:
    c = cfg("--deploy-block-v2", "7", "--deploy-block", "5")
    assert key(c) == [(2, V2_ADDR, 7, True, "built-in"), (1, V1_ADDR, 5, True, "built-in")]
    assert sum("deprecated" in n for n in c.notes) == 2


def test_deploy_block_without_that_version_is_refused() -> None:
    assert "v1" in usage("--network", "op-mainnet", "--registry", f"{B2}@3:v2", "--deploy-block", "5")
    assert "v2" in usage(
        "--registries-only", "--registry", "0x" + "c1" * 20 + "@1:v1", "--deploy-block-v2", "5"
    )
    usage("--deploy-block", "-1")


# ------------------------------------------------------------------ --deployment-file
def test_deployment_record_equal_to_the_built_ins_is_built_in(tmp_path: Path) -> None:
    """M2: a file that only restates the built-in entries raises no warning."""
    f = write(tmp_path, "11155420.json", json.loads(RECORD.read_text()))
    c = cfg("--deployment-file", f)
    assert c.network == "op-sepolia" and c.rpcs == list(NETWORKS["op-sepolia"].rpcs)
    assert c.registries == SEPOLIA
    assert "SECURITY" not in summary(c)


def test_deployment_file_with_a_new_version_and_a_flag_on_top(tmp_path: Path) -> None:
    doc = json.loads(RECORD.read_text())
    doc["contracts"]["vaultRegistries"] = {"v3": {"address": A3, "deployBlock": 60, "abiHash": V2_HASH}}
    f = write(tmp_path, "next.json", doc)
    c = cfg("--deployment-file", f, "--registry", f"{B2}@9:v2")
    assert key(c) == [*BUILT, (3, A3, 60, False, "from 'next.json'"), (2, B2, 9, False, "--registry")]
    assert "from 'next.json'" in summary(c)


def test_tampered_deployment_file_is_untrusted(tmp_path: Path) -> None:
    doc = json.loads(RECORD.read_text())
    doc["contracts"]["vaultRegistryV2"]["address"] = B2
    c = cfg("--deployment-file", write(tmp_path, "t.json", doc))
    assert key(c) == [*BUILT, (2, B2, 49755277, False, "from 't.json'")]
    assert "SECURITY" in summary(c)


def test_deployment_file_raising_a_built_in_block_is_refused(tmp_path: Path) -> None:
    doc = json.loads(RECORD.read_text())
    doc["contracts"]["vaultRegistryV2"]["deployBlock"] = 49755277 + 1000
    assert "49755277" in usage("--deployment-file", write(tmp_path, "late.json", doc))


def test_release_file_on_a_chain_without_built_ins_is_trusted_with_a_warning(tmp_path: Path) -> None:
    doc = {
        "name": "cryoshield-web",
        "config": {"chainId": 10, "registry": None, "registryV2": {"address": B2, "deployBlock": 4}},
    }
    c = cfg("--deployment-file", write(tmp_path, "release.json", doc))
    assert c.network == "op-mainnet" and key(c) == [(2, B2, 4, True, "from 'release.json'")]
    assert "no built-in registry for op-mainnet" in summary(c)


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
    assert key(c) == [(2, B2, 0, True, "from '777.json'")] and "block 0" in summary(c)


@pytest.mark.parametrize(
    "content",
    [
        "{oops",
        json.dumps({"chainId": 11155420}),
        json.dumps({"chainId": 11155420, "contracts": {"vaultRegistries": {"v4": {"address": A3}}}}),
        json.dumps({"hello": "world"}),
        '{"chainId": 10, "chainId": 11155420}',
        "[" * 100_000 + "]" * 100_000,
    ],
)
def test_bad_deployment_files_are_usage_errors(tmp_path: Path, content: str) -> None:
    p = tmp_path / "bad.json"
    p.write_text(content)
    usage("--deployment-file", str(p))
    usage("--deployment-file", str(tmp_path / "missing.json"))


# ------------------------------------------------------------------ startup summary (D9)
def test_summary_lists_built_ins_first_with_sources() -> None:
    text = summary(cfg("--registry", f"{A3}@500:v3:abi=v2"))
    lines = [ln.strip() for ln in text.splitlines() if ln.strip().startswith("registry v")]
    assert lines == [
        f"registry v2 {V2_ADDR} from block 49755277 (built-in)",
        f"registry v1 {V1_ADDR} from block 49568053 (built-in)",
        f"registry v3 (supplied) {A3} from block 500 (from --registry), read with the v2 ABI",
    ]
    assert "SECURITY" in text and "never make a copy count as current" in text


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


# ------------------------------------------------------------------ HIGH 1 end to end
def anvil_node(c: FakeChain) -> FakeChain:
    """Serve the anvil preset's built-in v2 address on ``c`` (its built-in v1 is ``c.address``)."""
    assert c.address == ANVIL[1].address
    c.enable_v2(ANVIL[0].address)
    return c


def run_main(args: list[str], *, interactive: bool = True, answer: str = "show\n") -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    ui = Console(io.StringIO(answer), out, err, getpass_fn=lambda _p: "1", interactive=interactive)
    code = cli.main(
        args, console=ui, prf_factory=lambda u: FakePrfSource([PhysicalKey.named("A", "B")], ui=u)
    )
    return code, out.getvalue(), err.getvalue()


def test_phished_newer_registry_cannot_roll_back_a_built_in_vault(tmp_path: Path) -> None:
    """HIGH 1: --registry 0xATTACKER@N:v99:abi=v2 serving an OLD genuine blob with a matching fake
    history must not outrank the built-in v2, whose current copy is shown."""
    with FakeChain(chain_id=31337) as c:
        anvil_node(c)
        c.add_vault_v2(VID, BLOB, [LOC_A, LOC_B])
        c.update_vault_v2(VID, NEW)
        evil = c.add_registry(A3)
        evil.add_vault_v2(VID, BLOB, [LOC_A, LOC_B])  # old genuine blob, with its own "history"
        out = tmp_path / "secret.txt"
        code, _, err = run_main(
            [
                "--network",
                "anvil",
                "--rpc",
                c.url,
                "--no-arweave",
                "--registry",
                f"{A3}@0:v99:abi=v2",
                "--output",
                str(out),
            ],
            interactive=False,
        )
    assert code == ExitCode.OK, err
    assert out.read_bytes() == NEW_SECRET
    assert "(registry v2: " in err and "this copy came from registry v99" not in err  # built-in copy used


def test_copy_only_in_a_supplied_registry_opens_with_warnings_everywhere(tmp_path: Path) -> None:
    with FakeChain(chain_id=31337) as c:
        anvil_node(c)
        v3 = c.add_registry(A3)
        v3.add_vault_v2(VID, BLOB, [LOC_A, LOC_B])
        out, saved = tmp_path / "secret.txt", tmp_path / "vault.bin"
        code, _, err = run_main(
            [
                "--network",
                "anvil",
                "--rpc",
                c.url,
                "--no-arweave",
                "--registry",
                f"{A3}@0:v3:abi=v2",
                "--output",
                str(out),
                "--save-blob",
                str(saved),
            ],
            interactive=False,
        )
    assert code == ExitCode.OK, err
    assert out.read_bytes() == SECRET
    assert f"SECURITY: this copy came from registry v3 {A3}" in err
    assert f"The saved copy came from registry v3 {A3}" in err
    assert f"The secret written came from registry v3 {A3}" in err
    assert "Could not confirm that this is the latest version" in err  # never CURRENT


def test_supplied_registry_cannot_hide_a_built_in_v1_vault(tmp_path: Path) -> None:
    """M3 end to end: --registry X:v1 with an empty X still finds the genuine built-in v1 vault."""
    with FakeChain(chain_id=31337) as c:
        anvil_node(c)
        c.add_vault(VID, BLOB, [LOC_A, LOC_B])
        out = tmp_path / "secret.txt"
        code, _, err = run_main(
            [
                "--network",
                "anvil",
                "--rpc",
                c.url,
                "--no-arweave",
                "--registry",
                "0x" + "c1" * 20 + "@0:v1",
                "--output",
                str(out),
            ],
            interactive=False,
        )
    assert code == ExitCode.OK, err
    assert out.read_bytes() == SECRET

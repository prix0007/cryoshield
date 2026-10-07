"""Network presets and selection (OpenSpec change target-op-sepolia, tasks 4.1 and 4.4)."""

from __future__ import annotations

import io
import json
from pathlib import Path

import pytest
from support.fakes import FakeChain
from support.keys import FakePrfSource, PhysicalKey
from support.vectors import REPO_ROOT

from cryoshield_recover import cli, config
from cryoshield_recover.config import DEFAULT_NETWORK, NETWORKS
from cryoshield_recover.errors import ExitCode
from cryoshield_recover.ui import Console

PRESETS_JSON = REPO_ROOT / "config" / "chain-presets.json"


def cfg(*argv: str) -> config.Config:
    return cli.config_from_args(cli.build_parser().parse_args(list(argv)))


def term() -> tuple[Console, io.StringIO]:
    err = io.StringIO()
    return Console(io.StringIO("no\n"), io.StringIO(), err, getpass_fn=lambda _p: "1", interactive=True), err


# ------------------------------------------------------------------ 4.1 selection
def test_default_network_is_op_sepolia() -> None:
    assert DEFAULT_NETWORK == "op-sepolia"
    c = cfg()
    assert c.network == "op-sepolia" and c.chain_id == 11155420
    assert c.rpcs == list(NETWORKS["op-sepolia"].rpcs)


def test_testnet_means_op_sepolia() -> None:
    c = cfg("--testnet")
    assert c.network == "op-sepolia" and c.chain_id == 11155420
    assert c.rpcs == [
        "https://sepolia.optimism.io",
        "https://optimism-sepolia-rpc.publicnode.com",
        "https://optimism-sepolia.drpc.org",
    ]


def test_network_flag_beats_testnet() -> None:
    c = cfg("--network", "op-mainnet", "--testnet")
    assert c.network == "op-mainnet" and c.chain_id == 10
    assert c.rpcs == [
        "https://mainnet.optimism.io",
        "https://optimism-rpc.publicnode.com",
        "https://optimism.drpc.org",
    ]


@pytest.mark.parametrize(("name", "chain_id"), [("arbitrum-one", 42161), ("arbitrum-sepolia", 421614)])
def test_arbitrum_presets_kept(name: str, chain_id: int) -> None:
    assert cfg("--network", name).chain_id == chain_id


def test_unknown_network_lists_valid_names(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as ei:
        cli.main(["--network", "base-sepolia"])
    assert ei.value.code == ExitCode.USAGE
    err = capsys.readouterr().err
    for name in NETWORKS:
        assert name in err


def test_every_public_preset_has_three_https_rpcs() -> None:
    for name, p in NETWORKS.items():
        if name == "anvil":
            continue
        assert len(p.rpcs) >= 3, name
        assert all(u.startswith("https://") for u in p.rpcs), name
        assert not any("cryoshield" in u or "omniatech" in u for u in p.rpcs), name


def test_chain_id_alone_selects_matching_preset() -> None:
    c = cfg("--chain-id", "10")
    assert c.network == "op-mainnet" and c.rpcs == list(NETWORKS["op-mainnet"].rpcs)


@pytest.mark.parametrize(
    "argv",
    [
        ["--network", "op-sepolia", "--chain-id", "777"],
        ["--network", "op-mainnet", "--chain-id", "11155420"],
        ["--network", "op-sepolia", "--chain-id", "777", "--rpc", "https://evil.example/rpc"],
        ["--testnet", "--chain-id", "10"],
    ],
)
def test_preset_with_conflicting_chain_id_is_refused(argv: list[str]) -> None:
    """Security review (target-op-sepolia): a preset's registry must never be used on another chain."""
    from cryoshield_recover.errors import RecoveryError

    with pytest.raises(RecoveryError) as ei:
        cfg(*argv)
    assert ei.value.exit_code == ExitCode.USAGE
    assert "--chain-id" in ei.value.message


def test_preset_with_matching_chain_id_is_fine() -> None:
    c = cfg("--network", "op-mainnet", "--chain-id", "10")
    assert c.network == "op-mainnet" and c.chain_id == 10


def test_custom_chain_requires_rpc() -> None:
    from cryoshield_recover.errors import RecoveryError

    with pytest.raises(RecoveryError) as ei:
        cfg("--chain-id", "777")
    assert ei.value.exit_code == ExitCode.USAGE and "--rpc" in ei.value.message


def test_custom_chain_with_rpc_uses_no_preset_registry() -> None:
    c = cfg("--chain-id", "777", "--rpc", "https://my-node.example/rpc")
    assert c.network == "custom" and c.chain_id == 777
    assert c.rpcs == ["https://my-node.example/rpc"]
    assert c.registries == []  # never another chain's registry
    c2 = cfg("--chain-id", "777", "--rpc", "https://my-node.example/rpc", "--registry", "0x" + "ab" * 20)
    assert [(s.version, s.address) for s in c2.registries] == [(1, "0x" + "ab" * 20)]


def test_user_supplied_endpoints_are_labelled() -> None:
    for argv in (
        ["--rpc", "https://my-node.example/rpc", "--registry", "0x" + "ab" * 20],
        ["--chain-id", "777", "--rpc", "https://my-node.example/rpc", "--registry", "0x" + "ab" * 20],
    ):
        console, err = term()
        cli.main(
            [*argv, "--no-arweave"],
            console=console,
            prf_factory=lambda ui: FakePrfSource([PhysicalKey.named("A")], ui=ui),
        )
        text = err.getvalue()
        assert "user-supplied" in text and "my-node.example" in text
        assert "op-sepolia endpoints" not in text


def test_rpc_override_keeps_preset_chain_id() -> None:
    c = cfg("--rpc", "https://my-node.example/rpc")
    assert c.chain_id == 11155420 and c.rpcs == ["https://my-node.example/rpc"]


def test_rpc_on_other_chain_without_chain_id_is_refused_with_hint() -> None:
    with FakeChain(chain_id=31337) as anvil_like:
        console, err = term()
        code = cli.main(
            ["--rpc", anvil_like.url, "--registry", anvil_like.address, "--no-arweave"],
            console=console,
            prf_factory=lambda ui: FakePrfSource([PhysicalKey.named("A")], ui=ui),
        )
    text = err.getvalue()
    assert code == ExitCode.NETWORK_UNAVAILABLE
    assert "chain 31337" in text and "--chain-id" in text


def test_startup_prints_network_name() -> None:
    console, err = term()
    cli.main(
        ["--no-arweave", "--no-chain"],  # offline-safe: the op-sepolia registry is live
        console=console,
        prf_factory=lambda ui: FakePrfSource([PhysicalKey.named("A")], ui=ui),
    )
    assert "Network: op-sepolia (chain 11155420)" in err.getvalue()


def test_op_sepolia_registry_is_the_live_deployment() -> None:
    """VaultRegistry is live on OP Sepolia (contracts/deployments/11155420.json), embedded at release."""
    v1 = NETWORKS["op-sepolia"].registries[-1]
    assert (v1.version, v1.address) == (1, "0xb43f58cf17e64b603ae5588a1dd17e96a0849e44")
    assert v1.deploy_block == 49568053
    assert cfg().registries[-1] == v1


def test_op_sepolia_registry_v2_is_the_live_deployment() -> None:
    """VaultRegistry v2 on OP Sepolia (contracts/deployments/11155420.json, contracts.vaultRegistryV2)."""
    v2 = NETWORKS["op-sepolia"].registries[0]
    assert (v2.version, v2.address) == (2, "0xa622c92d3d5b54aea081cf410224a8a2ecb08cb7")
    assert v2.deploy_block == 49755277
    assert cfg().registries[0] == v2


@pytest.mark.parametrize("name", ["op-mainnet", "arbitrum-one", "arbitrum-sepolia"])
def test_undeployed_presets_stay_placeholders(name: str) -> None:
    assert NETWORKS[name].registries == ()


def test_preset_without_deployment_refuses_chain_mode() -> None:
    console, err = term()
    code = cli.main(
        ["--network", "op-mainnet", "--no-arweave"],
        console=console,
        prf_factory=lambda ui: FakePrfSource([PhysicalKey.named("A")], ui=ui),
    )
    text = err.getvalue()
    assert "No VaultRegistry deployment is built in for op-mainnet" in text
    assert "--registry" in text and "--registry-v2" in text
    assert code == ExitCode.NETWORK_UNAVAILABLE


def test_deployments_file_not_read_at_runtime(monkeypatch: pytest.MonkeyPatch) -> None:
    import builtins

    real_open = builtins.open

    def guarded(file: object, *a: object, **k: object) -> object:
        assert "deployments" not in str(file), "deployment records must not be read at runtime"
        return real_open(file, *a, **k)  # type: ignore[call-overload]

    monkeypatch.setattr(builtins, "open", guarded)
    monkeypatch.setattr(Path, "read_text", lambda self, *a, **k: pytest.fail(f"read {self}"))
    cfg("--network", "anvil")
    cfg()


# ------------------------------------------------------------------ 4.4 parity
def test_presets_match_presets_json() -> None:
    ref = json.loads(PRESETS_JSON.read_text())
    expected = {p["name"]: p["chainId"] for p in ref["presets"]}
    assert {name: p.chain_id for name, p in NETWORKS.items()} == expected
    for p in ref["presets"]:
        assert p["foundryKey"] == p["name"].replace("-", "_")
    assert ref["defaultTestnet"] == DEFAULT_NETWORK == config.TESTNET


# Registry lists vs contracts/deployments/<chainId>.json: see test_registry_versions.py (parity, D4).


def test_registry_v2_flags() -> None:
    c = cfg("--registry-v2", "0x" + "2B" * 20, "--deploy-block-v2", "123")
    assert c.registries[:2] == list(NETWORKS["op-sepolia"].registries)  # built-ins kept, first
    supplied = c.registries[2]
    assert (supplied.version, supplied.address, supplied.deploy_block) == (2, "0x" + "2b" * 20, 123)
    assert not supplied.trusted


def test_registry_v2_flag_rejects_bad_address() -> None:
    import pytest as _pytest

    from cryoshield_recover.errors import RecoveryError

    with _pytest.raises(RecoveryError) as ei:
        cfg("--registry-v2", "0x1234")
    assert ei.value.exit_code == ExitCode.USAGE


def test_custom_chain_has_no_built_in_v2_registry() -> None:
    c = cfg("--chain-id", "777", "--rpc", "https://my-node.example/rpc")
    assert c.registries == [] and not c.has_registry


def test_v2_only_chain_is_configured_and_announced() -> None:
    """OP Mainnet will carry only v2: chain lookup is on with a v2 address and no v1 address."""
    c = cfg("--network", "op-mainnet", "--registry-v2", "0x" + "2b" * 20)
    assert [s.version for s in c.registries] == [2] and c.chain_configured
    console, err = term()
    cli.startup_summary(c, console)
    text = err.getvalue()
    assert "lookup is off" not in text
    assert "registry v2 0x" + "2b" * 20 in text and "registry v1" not in text


def test_both_registries_announced() -> None:
    console, err = term()
    cli.startup_summary(cfg("--registry-v2", "0x" + "2b" * 20), console)
    text = err.getvalue()
    assert "registry v2 (supplied) 0x" + "2b" * 20 in text and "registry v1 0xb43f58cf" in text


def test_overriding_a_registry_without_its_deploy_block_scans_from_genesis() -> None:
    """A preset's deploy block belongs to the preset's address: with another address it could skip that
    deployment's first events and make its history look empty. Use 0 (slower, never wrong) and warn."""
    c = cfg("--registry-v2", "0x" + "2b" * 20, "--registry", "0x" + "3c" * 20)
    supplied = [s for s in c.registries if not s.trusted]
    assert [s.deploy_block for s in supplied] == [0, 0]
    assert not any(s.block_known for s in supplied)
    console, err = term()
    cli.startup_summary(c, console)
    text = err.getvalue()
    assert "block 0" in text
    assert (
        f"--registry {'0x' + '2b' * 20}@BLOCK:v2" in text
        and f"--registry {'0x' + '3c' * 20}@BLOCK:v1" in text
    )
    kept = cfg("--registry-v2", "0x" + "2b" * 20, "--deploy-block-v2", "7")
    assert kept.registries[-1].deploy_block == 7
    same = cfg("--registry-v2", NETWORKS["op-sepolia"].registries[0].address)
    assert same.registries[0] == NETWORKS["op-sepolia"].registries[0]

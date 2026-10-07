"""CLI and terminal UX (tasks 9.1, 9.3, 9.4)."""

from __future__ import annotations

import io
import logging
import os
import stat
from pathlib import Path
from typing import Any

import pytest
from support import vectors
from support.fakes import FakeChain
from support.keys import BY_NAME, FakePrfSource, PhysicalKey
from support.vectors import h

from cryoshield_recover import cli
from cryoshield_recover.config import DEFAULT_NETWORK, NETWORKS
from cryoshield_recover.errors import ExitCode
from cryoshield_recover.ui import Console

V2 = vectors.cases("vaults")[0]
SECRET_TEXT = h(V2["secret"]).decode()
VID = h(V2["vaultId"])
PIN = "246813"


class Term:
    def __init__(self, answer: str = "show\n", interactive: bool = True) -> None:
        self.stdin = io.StringIO(answer)
        self.stdout = io.StringIO()
        self.stderr = io.StringIO()
        self.console = Console(
            self.stdin, self.stdout, self.stderr, getpass_fn=lambda _p: PIN, interactive=interactive
        )


@pytest.fixture
def chain() -> Any:
    with FakeChain() as c:
        c.add_vault(VID, h(V2["blob"]), [h(BY_NAME["A"]["locator"]), h(BY_NAME["B"]["locator"])])
        yield c


def chain_args(c: FakeChain) -> list[str]:
    return ["--rpc", c.url, "--registry", c.address, "--chain-id", str(c.chain_id), "--no-arweave"]


def run_cli(args: list[str], term: Term, keys: list[PhysicalKey] | None = None) -> tuple[int, FakePrfSource]:
    holder: dict[str, FakePrfSource] = {}

    def factory(ui: Console) -> FakePrfSource:
        holder["prf"] = FakePrfSource(keys or [PhysicalKey.named("A")], ui=ui)
        return holder["prf"]

    code = cli.main(args, console=term.console, prf_factory=factory)
    return code, holder.get("prf")  # type: ignore[return-value]


# ------------------------------------------------------------------ config / flags
def test_defaults_and_overrides() -> None:
    p = cli.build_parser()
    cfg = cli.config_from_args(p.parse_args([]))
    assert cfg.rp_id == "cryoshield.app" and cfg.chain_id == 11155420 and len(cfg.rpcs) >= 3
    assert len(cfg.arweave_graphql) >= 2 and len(cfg.arweave_gateways) >= 2
    assert all(u.startswith("https://") for u in cfg.rpcs + cfg.arweave_graphql + cfg.arweave_gateways)
    cfg = cli.config_from_args(
        p.parse_args(
            [
                "--rpc",
                "https://a.example/rpc",
                "--rpc",
                "http://127.0.0.1:8545",
                "--registry",
                "0x" + "Ab" * 20,
                "--rp-id",
                "x.example",
                "--chain-id",
                "5",
                "--arweave-graphql",
                "https://g.example/graphql",
                "--arweave-gateway",
                "https://d.example",
            ]
        )
    )
    assert cfg.rpcs == ["https://a.example/rpc", "http://127.0.0.1:8545"]
    assert [(s.version, s.address) for s in cfg.registries] == [(1, "0x" + "ab" * 20)]
    assert cfg.rp_id == "x.example" and cfg.chain_id == 5
    assert cfg.arweave_graphql == ["https://g.example/graphql"] and cfg.arweave_gateways == [
        "https://d.example"
    ]
    t = cli.config_from_args(p.parse_args(["--testnet"]))
    assert t.chain_id == 11155420 and t.network == "op-sepolia"


@pytest.mark.parametrize(
    "args",
    [
        ["--rpc", "http://evil.example/rpc"],
        ["--registry", "0x1234"],
        ["--vault-id", "zz"],
        ["--credential-id", "!!"],
        ["--offline"],
        ["--vault-id", "11" * 32, "--credential-id", "abcd"],
        ["--blob-file", "x.bin", "--offline"],
    ],
)
def test_bad_flags_are_usage_errors(args: list[str]) -> None:
    term = Term()
    code, prf = run_cli(args, term)
    assert code == ExitCode.USAGE and prf is None


def test_credential_id_formats() -> None:
    from cryoshield_recover.config import parse_credential_id

    assert parse_credential_id("0x0102") == b"\x01\x02"
    assert parse_credential_id("AQI") == b"\x01\x02"


def test_startup_summary_lists_endpoints_before_contact(chain: FakeChain) -> None:
    term = Term()
    run_cli(chain_args(chain), term)
    err = term.stderr.getvalue()
    summary = err.index("Will contact only these public servers")
    assert chain.url.split("//")[1] in err[summary:]
    assert summary < err.index("Looking up your vault")


def test_placeholder_registry_warns_and_skips_chain() -> None:
    term = Term()
    code, _ = run_cli(["--network", "op-mainnet", "--no-arweave"], term)
    assert "No VaultRegistry deployment is built in" in term.stderr.getvalue()
    assert code == ExitCode.NETWORK_UNAVAILABLE


# ------------------------------------------------------------------ showing secrets
def test_typed_show_prints_secret(chain: FakeChain) -> None:
    term = Term("show\n")
    code, _ = run_cli(chain_args(chain), term)
    assert code == ExitCode.OK
    assert SECRET_TEXT in term.stdout.getvalue()
    assert SECRET_TEXT not in term.stderr.getvalue()
    assert "0x" + VID.hex() in term.stderr.getvalue()


@pytest.mark.parametrize("answer", ["y\n", "yes\n", "\n", "", "SHOW please\n"])
def test_anything_else_declines(chain: FakeChain, answer: str) -> None:
    term = Term(answer)
    code, prf = run_cli(chain_args(chain), term)
    assert code == ExitCode.OK
    assert term.stdout.getvalue() == ""
    assert all(b == bytearray(32) for b in prf.handed_out)


def test_non_interactive_refuses_before_touching_key(chain: FakeChain) -> None:
    term = Term(interactive=False)
    code, prf = run_cli(chain_args(chain), term)
    assert code == ExitCode.OUTPUT_REFUSED and prf is None
    assert "--output" in term.stderr.getvalue()
    assert term.stdout.getvalue() == ""


def test_output_file_created_0600(chain: FakeChain, tmp_path: Path) -> None:
    out = tmp_path / "secret.txt"
    term = Term(interactive=False)
    code, _ = run_cli([*chain_args(chain), "--output", str(out)], term)
    assert code == ExitCode.OK
    assert out.read_bytes() == h(V2["secret"])
    if os.name == "posix":
        assert stat.S_IMODE(out.stat().st_mode) == 0o600
    assert term.stdout.getvalue() == ""


def test_output_never_overwrites(chain: FakeChain, tmp_path: Path) -> None:
    out = tmp_path / "secret.txt"
    out.write_text("keep me")
    code, prf = run_cli([*chain_args(chain), "--output", str(out)], Term())
    assert code == ExitCode.OUTPUT_REFUSED and prf is None
    assert out.read_text() == "keep me"


def test_output_symlink_refused(chain: FakeChain, tmp_path: Path) -> None:
    target = tmp_path / "elsewhere"
    link = tmp_path / "link"
    link.symlink_to(target)
    code, _ = run_cli([*chain_args(chain), "--output", str(link)], Term())
    assert code == ExitCode.OUTPUT_REFUSED and not target.exists()


def test_save_blob(chain: FakeChain, tmp_path: Path) -> None:
    saved = tmp_path / "vault.bin"
    code, _ = run_cli([*chain_args(chain), "--save-blob", str(saved)], Term("no\n"))
    assert code == ExitCode.OK and saved.read_bytes() == h(V2["blob"])
    # ...which then works fully offline with --blob-file
    term = Term()
    code, _ = run_cli(
        ["--blob-file", str(saved), "--vault-id", VID.hex(), "--offline"], term, [PhysicalKey.named("B")]
    )
    assert code == ExitCode.OK and SECRET_TEXT in term.stdout.getvalue()


def test_binary_secret_shown_as_hex() -> None:
    term = Term()
    term.console.show_secret(bytearray(b"\xff\x00\x10"))
    assert "ff0010" in term.stdout.getvalue()
    assert "hexadecimal" in term.stderr.getvalue()


def test_exit_codes_documented(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit):
        cli.main(["--help"])
    out = capsys.readouterr().out
    for code in ExitCode:
        assert f"{code.value:>2}  {code.name.lower().replace('_', ' ')}" in out


def test_no_credential_message(chain: FakeChain) -> None:
    term = Term()
    code, _ = run_cli(chain_args(chain), term, [PhysicalKey.named("A", discoverable=False)])
    assert code == ExitCode.NO_CREDENTIAL
    assert "--vault-id" in term.stderr.getvalue()


def test_pause_requires_interactive() -> None:
    from cryoshield_recover.errors import RecoveryError

    with pytest.raises(RecoveryError):
        Term(interactive=False).console.pause("insert another key")


# ------------------------------------------------------------------ hygiene (9.4)
def _secret_forms() -> list[bytes]:
    a = BY_NAME["A"]
    vals = [h(a["prf"]), h(a["wrapKey"]), h(V2["dataKey"]), h(V2["secret"])]
    return [x for v in vals for x in (v, v.hex().encode(), v[:16].hex().encode())] + [PIN.encode()]


def test_verbose_logs_contain_no_secrets(chain: FakeChain, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    term = Term("no\n")
    code, _ = run_cli([*chain_args(chain), "--verbose"], term)
    assert code == ExitCode.OK
    logged = "\n".join(r.getMessage() for r in caplog.records).encode() + term.stderr.getvalue().encode()
    assert caplog.records, "verbose mode should produce diagnostics"
    for s in _secret_forms():
        assert s not in logged


def test_crash_path_wipes_and_reveals_nothing(chain: FakeChain) -> None:
    holder: dict[str, FakePrfSource] = {}

    def factory(ui: Console) -> FakePrfSource:
        holder["prf"] = FakePrfSource([PhysicalKey.named("A")], ui=ui)
        return holder["prf"]

    def exploding_registry(cfg: Any) -> Any:
        raise RuntimeError("boom " + BY_NAME["A"]["prf"])  # even a hostile message must not be echoed

    term = Term()
    code = cli.main(
        chain_args(chain),
        console=term.console,
        prf_factory=factory,
        registry_factory=exploding_registry,
    )
    assert code == ExitCode.INTERNAL
    out = term.stderr.getvalue() + term.stdout.getvalue()
    assert "RuntimeError" in out
    for s in _secret_forms():
        assert s.decode(errors="ignore") not in out
    assert holder["prf"].handed_out and all(b == bytearray(32) for b in holder["prf"].handed_out)


def test_core_dumps_disabled(chain: FakeChain) -> None:
    if os.name != "posix":
        pytest.skip("POSIX only")
    import resource

    run_cli(chain_args(chain), Term("no\n"))
    assert resource.getrlimit(resource.RLIMIT_CORE)[0] == 0


# ------------------------------------------------------------------ release guard
@pytest.mark.release
def test_release_has_real_registry_address() -> None:
    assert NETWORKS[DEFAULT_NETWORK].registries, f"fill in the {DEFAULT_NETWORK} registries before release"
    assert all(s.deploy_block > 0 for s in NETWORKS[DEFAULT_NETWORK].registries)

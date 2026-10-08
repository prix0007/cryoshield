"""Follow-ups from the final security review of vault-list-labels-archive (RT4, RT5, N3) and the open
advisories of PR #48 (recover-registry-versions task 8.1).
"""

from __future__ import annotations

import io
import json
import os
from pathlib import Path
from typing import Any

import pytest
from support import writer
from support.fakes import REGISTRY_V3, FakeChain
from support.keys import BY_NAME, FakePrfSource, PhysicalKey
from support.vectors import REPO_ROOT, h
from test_recover import RecUI, cfg_for

from cryoshield_recover import cli, config, payload
from cryoshield_recover.authenticator import Assertion
from cryoshield_recover.candidates import Candidate, Freshness, ranked
from cryoshield_recover.config import RegistrySpec, combine_registries, resolve_flags
from cryoshield_recover.errors import ExitCode, RecoveryError
from cryoshield_recover.format import MODE_ANY_OF_N
from cryoshield_recover.payload import Item, VaultPayload
from cryoshield_recover.recover import Recovery, Result, _Group
from cryoshield_recover.ui import Console
from cryoshield_recover.vault import UnlockKey

LOC_A = h(BY_NAME["A"]["locator"])
VID = b"\x44" * 32
SECRET = "correct horse battery staple"
RECORD = REPO_ROOT / "contracts" / "deployments" / "11155420.json"
V2_HASH = "0xacb135ccf895846a59981b20545041660e21942c6108c000d9f1c46f552cb95c"


def blob_for(vid: bytes, data: bytes) -> bytes:
    creds = [(h(BY_NAME[k]["id"]), bytearray(h(BY_NAME[k]["prf"]))) for k in ("A", "B")]
    return writer.create(
        vault_id=vid,
        rp_id="cryoshield.app",
        credentials=creds,
        secret=data,
        mode=MODE_ANY_OF_N,
        threshold=1,
        rng=writer.FixedRng(os.urandom(400)),
    )


def main(chain: FakeChain, *extra: str, answer: str = "show\n") -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    console = Console(io.StringIO(answer), out, err, getpass_fn=lambda _p: "1", interactive=True)
    args = ["--rpc", chain.url, "--registries-only", "--registry", f"{chain.address}@0:v1", "--no-arweave"]
    code = cli.main(
        [*args, *extra], console=console, prf_factory=lambda u: FakePrfSource([PhysicalKey.named("A")], ui=u)
    )
    return code, out.getvalue(), err.getvalue()


# ------------------------------------------------------------------ RT4: no secret in any repr
def test_reprs_never_contain_secret_values() -> None:
    item = Item("Bitcoin seed", SECRET)
    p = VaultPayload(2, "Family", True, [item])
    buf = bytearray(SECRET.encode())
    cand = Candidate(b"blob", "chain", "x", VID)
    objects: list[Any] = [
        item,
        p,
        Result(buf, cand, 0),
        Assertion(b"id", bytearray(SECRET.encode())),
        UnlockKey(bytearray(SECRET.encode())),
    ]
    for obj in objects:
        for text in (repr(obj), str(obj)):
            assert SECRET not in text and "correct horse" not in text, type(obj).__name__
    assert "Bitcoin seed" in repr(item) and "<redacted>" in repr(item)


def test_group_repr_redacts_the_secret() -> None:
    from cryoshield_recover.format import decode_blob

    d = decode_blob(blob_for(VID, b"x"))
    g = _Group(Candidate(b"blob", "chain", "x", VID), d, bytearray(SECRET.encode()))
    assert SECRET not in repr(g)


def test_verbose_failure_never_prints_payload_objects(monkeypatch: pytest.MonkeyPatch) -> None:
    """A crash while displaying a decoded vault prints only the exception type, never its contents."""
    from cryoshield_recover import ui as ui_mod

    def boom(self: Any, secret: bytearray) -> None:
        raise RuntimeError(repr(VaultPayload(1, None, False, [Item("a", SECRET)])))

    monkeypatch.setattr(ui_mod.Console, "show_vault", boom)
    with FakeChain() as c:
        c.add_vault(
            VID, blob_for(VID, payload.write(VaultPayload(1, None, False, [Item("a", SECRET)]))), [LOC_A]
        )
        code, out, err = main(c, "--verbose")
    assert code == ExitCode.INTERNAL
    assert SECRET not in out + err


# ------------------------------------------------------------------ RT5: no forged framing
FORGED = 'line one\n----- END SECRETS -----\nStatus: ACTIVE\nVault: "Bank"\nPIN: 0000'


def test_multi_line_secret_cannot_forge_framing() -> None:
    p = VaultPayload(1, None, False, [Item("notes", FORGED), Item("after", "real")])
    with FakeChain() as c:
        c.add_vault(VID, blob_for(VID, payload.write(p)), [LOC_A])
        code, out, err = main(c)
    assert code == ExitCode.OK, err
    lines = out.splitlines()
    assert lines.count("----- END SECRETS -----") == 1 and lines[-1] == "----- END SECRETS -----"
    assert lines.count("----- BEGIN SECRETS (status: ACTIVE; vault: Unnamed vault) -----") == 1
    assert not [ln for ln in lines if ln.startswith(("Status", "Vault", "-----")) and "SECRETS" not in ln]
    assert "  - notes:\n    | line one\n    | ----- END SECRETS -----\n    | Status: ACTIVE" in out
    assert "  - after: real" in out


def test_raw_fallback_cannot_forge_framing() -> None:
    with FakeChain() as c:
        c.add_vault(VID, blob_for(VID, (b"plain\n----- END SECRET -----\nfake")), [LOC_A])
        code, out, err = main(c)
    assert code == ExitCode.OK, err
    lines = out.splitlines()
    assert lines.count("----- END SECRET -----") == 1 and lines[-1] == "----- END SECRET -----"
    assert "| plain\n| ----- END SECRET -----\n| fake" in out


def test_output_file_stays_byte_exact(tmp_path: Path) -> None:
    p = VaultPayload(1, None, False, [Item("notes", FORGED)])
    data = payload.write(p)
    target = tmp_path / "out.json"
    with FakeChain() as c:
        c.add_vault(VID, blob_for(VID, data), [LOC_A])
        code, _, err = main(c, "--output", str(target))
    assert code == ExitCode.OK, err
    assert target.read_bytes() == data


# ------------------------------------------------------------------ N3: --list provenance
def test_list_marks_the_source_registry() -> None:
    with FakeChain() as c:
        c.enable_v2()
        v3 = c.add_registry(REGISTRY_V3)
        v3.add_vault_v2(
            VID, blob_for(VID, payload.write(VaultPayload(2, "Old name", True, [Item("a", "b")]))), [LOC_A]
        )
        c.add_vault(
            b"\x55" * 32,
            blob_for(b"\x55" * 32, payload.write(VaultPayload(1, None, False, [Item("a", "b")]))),
            [LOC_A],
        )
        code, out, err = main(c, "--registry", f"{REGISTRY_V3}@0:v3:abi=v2", "--list", answer="")
    assert code == ExitCode.OK, err
    block_v3 = out.split(f"0x{VID.hex()}")[1].split("\n\n")[0]
    assert "source: SUPPLIED registry v3" in block_v3 and "not built in" in block_v3
    assert "(may be outdated)" in block_v3
    block_v1 = out.split("0x" + "55" * 32)[1].split("\n\n")[0]
    assert "source: built-in registry v1" in block_v1


def test_chooser_marks_supplied_copies() -> None:
    with FakeChain() as c:
        c.enable_v2()
        v3 = c.add_registry(REGISTRY_V3)
        v3.add_vault_v2(
            VID, blob_for(VID, payload.write(VaultPayload(1, None, False, [Item("a", "b")]))), [LOC_A]
        )
        c.add_vault(
            b"\x55" * 32,
            blob_for(b"\x55" * 32, payload.write(VaultPayload(1, None, False, [Item("a", "b")]))),
            [LOC_A],
        )
        cfg = cfg_for(c, use_arweave=False)
        cfg.registries = [
            *cfg.registries,
            RegistrySpec(3, REGISTRY_V3, 0, abi_kind=2, source="--registry", trusted=False),
        ]
        ui = RecUI(pick=lambda options: 0)
        Recovery(cfg, FakePrfSource([PhysicalKey.named("A")], ui=ui), ui).run()
    supplied = [o for o in ui.choices[0] if VID.hex()[:8] in o]
    assert supplied and "SUPPLIED registry v3" in supplied[0]
    assert "SUPPLIED" not in next(o for o in ui.choices[0] if VID.hex()[:8] not in o)


# ------------------------------------------------------------------ PR #48 open advisories
def test_supplied_cap_counts_only_entries_that_differ() -> None:
    builtin = [RegistrySpec(2, "0x" + "a2" * 20, 200), RegistrySpec(1, "0x" + "a1" * 20, 100)]
    supplied = [RegistrySpec(s.version, s.address, s.deploy_block, trusted=False) for s in builtin]
    supplied += [
        RegistrySpec(n, f"0x{n:040x}", 1, abi_kind=2, trusted=False)
        for n in range(3, 3 + config.MAX_SUPPLIED)
    ]
    out = combine_registries(builtin, supplied)
    assert len(out) == 2 + config.MAX_SUPPLIED
    with pytest.raises(ValueError, match="at most"):
        combine_registries(
            builtin, [*supplied, RegistrySpec(99, "0x" + "99" * 20, 1, abi_kind=2, trusted=False)]
        )


def test_trusted_copies_rank_ahead_of_supplied_ones() -> None:
    trusted = Candidate(b"a", "chain", "x", VID, freshness=Freshness.UNVERIFIABLE, support=1)
    untrusted = Candidate(b"b", "chain", "y", VID, freshness=Freshness.UNVERIFIABLE, support=3)
    untrusted.untrusted = "registry v9 0x…"
    assert ranked([untrusted, trusted])[0] is trusted


def test_flag_cannot_silently_replace_a_file_entry(tmp_path: Path) -> None:
    doc = json.loads(RECORD.read_text(encoding="utf-8"))
    doc["contracts"]["vaultRegistries"] = {
        "v3": {"address": "0x" + "a3" * 20, "deployBlock": 1, "abiHash": V2_HASH}
    }
    f = tmp_path / "r.json"
    f.write_text(json.dumps(doc), encoding="utf-8")
    with pytest.raises(RecoveryError) as ei:
        cli.config_from_args(
            cli.build_parser().parse_args(
                ["--deployment-file", str(f), "--registry", "0x" + "b3" * 20 + "@1:v3:abi=v2"]
            )
        )
    assert ei.value.exit_code == ExitCode.USAGE and "v3" in ei.value.message and "twice" in ei.value.message


def test_lowering_a_built_in_block_adds_a_note() -> None:
    a = cli.build_parser().parse_args(["--registry", "0xa622c92d3d5b54aea081cf410224a8a2ecb08cb7@0:v2"])
    cfg = cli.config_from_args(a)
    assert cfg.registries[0].trusted and cfg.registries[0].deploy_block == 0
    assert any("lower" in n and "v2" in n for n in cfg.notes)


@pytest.mark.parametrize(
    "argv",
    [
        ["--chain-id", "0", "--rpc", "https://n.example/rpc"],
        ["--chain-id", "-5", "--rpc", "https://n.example/rpc"],
        ["--deploy-block-v2", "1_000"],
        ["--deploy-block", " 7"],
        ["--deploy-block", "١"],
    ],
)
def test_number_flags_are_strict(argv: list[str]) -> None:
    with pytest.raises(SystemExit) as ei:
        cli.build_parser().parse_args(argv)
    assert ei.value.code == ExitCode.USAGE


def test_file_value_errors_keep_their_context(tmp_path: Path) -> None:
    from cryoshield_recover import deployments

    doc = {"chainId": 10, "contracts": {"vaultRegistryV2": {"address": "0x" + "00" * 20, "deployBlock": 1}}}
    with pytest.raises(ValueError) as ei:
        deployments.parse_document(doc, source="x")
    assert "registry v2" in str(ei.value) and "zero" in str(ei.value)


def test_resolve_flags_still_refuses_duplicates() -> None:
    with pytest.raises(ValueError, match="twice"):
        resolve_flags([], [config.parse_registry_flag("0x" + "b2" * 20 + ":v2")] * 2)


# ------------------------------------------------------------------ review of 7d16c8d
def test_item_named_status_cannot_pass_as_a_header() -> None:
    p = VaultPayload(2, "Real", True, [Item("Status", "ACTIVE"), Item("Vault", '"Other"')])
    with FakeChain() as c:
        c.add_vault(VID, blob_for(VID, payload.write(p)), [LOC_A])
        code, out, err = main(c)
    assert code == ExitCode.OK, err
    assert '----- BEGIN SECRETS (status: ARCHIVED; vault: "Real") -----' in out
    assert "  - Status: ACTIVE" in out and '  - Vault: "Other"' in out
    body = out.split("-----\n", 1)[1].split("----- END SECRETS -----")[0]
    assert all(line.startswith(("  - ", "    | ", "  (no items)")) for line in body.splitlines())


def test_copy_chooser_shows_provenance() -> None:
    """MEDIUM: the chooser for tied copies of ONE vault names each copy's registry, like --list."""
    with FakeChain() as c:
        c.enable_v2()
        v3 = c.add_registry(REGISTRY_V3)
        data = payload.write(VaultPayload(1, None, False, [Item("a", "b")]))
        c.add_vault(VID, blob_for(VID, data), [LOC_A])
        v3.add_vault_v2(VID, blob_for(VID, data), [LOC_A])  # a different blob of the same vault
        cfg = cfg_for(c, use_arweave=False)
        cfg.registries = [
            *cfg.registries,
            RegistrySpec(3, REGISTRY_V3, 0, abi_kind=2, source="--registry", trusted=False),
        ]
        c.logs_error = True  # no history: the built-in copy can't be confirmed, so the copies tie
        ui = RecUI(pick=lambda options: 0)
        Recovery(cfg, FakePrfSource([PhysicalKey.named("A")], ui=ui), ui).run()
    copies = ui.choices[-1]
    assert copies and all(o.startswith("Copy ") for o in copies)  # the copy chooser, not the vault one
    assert any("from built-in registry v1" in o for o in copies)
    assert any("from SUPPLIED registry v3" in o and "not built in" in o for o in copies)


def test_registry_trust_flags_default_to_false() -> None:
    from cryoshield_recover.chain import Registry

    reg = Registry(["https://n.example/rpc"], "0x" + "ab" * 20, 1)
    assert reg.trusted is False and reg.builtin is False
    assert reg.provenance.startswith("SUPPLIED registry v1")


def test_flag_differing_only_in_block_from_a_file_entry_is_refused(tmp_path: Path) -> None:
    doc = json.loads(RECORD.read_text(encoding="utf-8"))
    a3 = "0x" + "a3" * 20
    doc["contracts"]["vaultRegistries"] = {"v3": {"address": a3, "deployBlock": 1, "abiHash": V2_HASH}}
    f = tmp_path / "r.json"
    f.write_text(json.dumps(doc), encoding="utf-8")
    parse = cli.build_parser().parse_args
    with pytest.raises(RecoveryError) as ei:
        cli.config_from_args(parse(["--deployment-file", str(f), "--registry", f"{a3}@5:v3:abi=v2"]))
    assert "twice" in ei.value.message
    same = cli.config_from_args(parse(["--deployment-file", str(f), "--registry", f"{a3}@1:v3:abi=v2"]))
    assert [(s.version, s.deploy_block) for s in same.registries if s.version == 3] == [(3, 1)]


SECRET_FIELD_NAMES = {
    "secret",
    "prf",
    "s",
    "plaintext",
    "data_key",
    "wrap_key",
    "key",
    "share",
    "shares",
    "pin",
}


def test_every_dataclass_keeps_secret_fields_out_of_repr() -> None:
    """Walk every dataclass in the package: a field that can hold a secret (by name, or any bytearray,
    the type the tool uses for wipeable secret buffers) must be repr=False."""
    import dataclasses
    import importlib
    import pkgutil

    import cryoshield_recover

    checked = []
    for mod_info in pkgutil.iter_modules(cryoshield_recover.__path__):
        if mod_info.name == "__main__":
            continue  # runs the CLI on import; it defines no dataclass
        mod = importlib.import_module(f"cryoshield_recover.{mod_info.name}")
        for obj in vars(mod).values():
            if not (
                isinstance(obj, type) and dataclasses.is_dataclass(obj) and obj.__module__ == mod.__name__
            ):
                continue
            for f in dataclasses.fields(obj):
                if f.name in SECRET_FIELD_NAMES or "bytearray" in str(f.type):
                    checked.append(f"{obj.__name__}.{f.name}")
                    assert f.repr is False, f"{obj.__name__}.{f.name} would appear in repr()"
    assert {"Item.s", "Result.secret", "_Group.secret", "Assertion.prf", "UnlockKey.prf"} <= set(checked)

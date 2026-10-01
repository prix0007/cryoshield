"""bind-vault-id-to-ciphertext adoption: a cloned blob is never shown (regression for the clone attack)."""

from __future__ import annotations

import io
from pathlib import Path

import pytest
from support import vectors
from support.fakes import FakeArweave, FakeChain
from support.keys import BY_NAME, FakePrfSource, PhysicalKey
from support.vectors import h
from test_recover import RecUI, cfg_for

from cryoshield_recover import cli
from cryoshield_recover.errors import ExitCode, RecoveryError
from cryoshield_recover.recover import Recovery
from cryoshield_recover.ui import Console

V2 = {v["name"]: v for v in vectors.cases("vaults")}["any-of-2"]
BLOB = h(V2["blob"])
VID = h(V2["vaultId"])
ATTACKER_VID = bytes(b ^ 0xA5 for b in VID)
LOC_A, LOC_B = h(BY_NAME["A"]["locator"]), h(BY_NAME["B"]["locator"])
SECRET = h(V2["secret"])


def run(cfg: object) -> tuple[object, FakePrfSource, RecUI]:
    ui = RecUI()
    prf = FakePrfSource([PhysicalKey.named("A")], ui=ui)
    return Recovery(cfg, prf, ui).run(), prf, ui  # type: ignore[arg-type]


def test_clone_listed_first_is_skipped_genuine_selected() -> None:
    with FakeChain() as chain:
        chain.add_vault(ATTACKER_VID, BLOB, [LOC_A, LOC_B], owner="0x" + "66" * 20)  # byte-identical clone
        chain.add_vault(VID, BLOB, [LOC_A, LOC_B])
        res, _, _ = run(cfg_for(chain))
    assert res.candidate.vault_id == VID  # type: ignore[attr-defined]
    assert bytes(res.secret) == SECRET  # type: ignore[attr-defined]


def test_clone_only_is_never_shown() -> None:
    """A stale or attacker-held clone with its own consistent events must not decrypt."""
    with FakeChain() as chain:
        chain.add_vault(ATTACKER_VID, BLOB, [LOC_A, LOC_B], owner="0x" + "66" * 20)
        with pytest.raises(RecoveryError) as ei:
            run(cfg_for(chain))
    assert ei.value.exit_code == ExitCode.NO_MATCHING_VAULT


def test_vault_id_flag_pointing_at_clone_is_never_shown() -> None:
    with FakeChain() as chain:
        chain.add_vault(ATTACKER_VID, BLOB, [LOC_A, LOC_B], owner="0x" + "66" * 20)
        with pytest.raises(RecoveryError) as ei:
            run(cfg_for(chain, vault_id=ATTACKER_VID))
    assert ei.value.exit_code == ExitCode.NO_MATCHING_VAULT


def test_arweave_clone_under_attacker_tag_is_never_shown() -> None:
    with FakeChain() as chain, FakeArweave() as ar:
        chain.down = True
        ar.mirror(BLOB, vault_id=ATTACKER_VID, locators=[LOC_A])
        with pytest.raises(RecoveryError) as ei:
            run(cfg_for(chain, ar))
    assert ei.value.exit_code == ExitCode.NO_MATCHING_VAULT


def test_arweave_copy_uses_its_tag_vault_id() -> None:
    with FakeChain() as chain, FakeArweave() as ar:
        chain.down = True
        ar.mirror(BLOB, vault_id=ATTACKER_VID, locators=[LOC_A], height=999)  # newest, but a clone
        ar.mirror(BLOB, vault_id=VID, locators=[LOC_A], height=1)
        res, _, _ = run(cfg_for(chain, ar))
    assert res.candidate.vault_id == VID and res.candidate.source == "arweave"  # type: ignore[attr-defined]
    assert bytes(res.secret) == SECRET  # type: ignore[attr-defined]


# ------------------------------------------------------------------ --blob-file needs --vault-id
def _cli(args: list[str]) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    console = Console(io.StringIO("show\n"), out, err, getpass_fn=lambda _p: "1", interactive=True)
    code = cli.main(
        args, console=console, prf_factory=lambda ui: FakePrfSource([PhysicalKey.named("A")], ui=ui)
    )
    return code, out.getvalue(), err.getvalue()


def test_blob_file_requires_vault_id(tmp_path: Path) -> None:
    f = tmp_path / "vault.bin"
    f.write_bytes(BLOB)
    code, out, err = _cli(["--blob-file", str(f), "--offline"])
    assert code == ExitCode.USAGE and out == ""
    assert "--vault-id" in err


def test_blob_file_with_vault_id_offline(tmp_path: Path) -> None:
    f = tmp_path / "vault.bin"
    f.write_bytes(BLOB)
    code, out, err = _cli(["--blob-file", str(f), "--vault-id", VID.hex(), "--offline"])
    assert code == ExitCode.OK, err
    assert SECRET.decode() in out


def test_blob_file_with_wrong_vault_id_shows_nothing(tmp_path: Path) -> None:
    f = tmp_path / "vault.bin"
    f.write_bytes(BLOB)
    code, out, _ = _cli(["--blob-file", str(f), "--vault-id", ATTACKER_VID.hex(), "--offline"])
    assert code == ExitCode.NO_MATCHING_VAULT and out == ""


def test_zero_vault_id_rejected() -> None:
    code, _, err = _cli(["--vault-id", "00" * 32, "--no-arweave"])
    assert code == ExitCode.USAGE and "zero" in err

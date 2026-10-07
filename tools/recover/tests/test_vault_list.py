"""Every vault a key opens, payload-aware display and --list (vault-list-labels-archive tasks 5.1-5.2).

The vault-recovery deltas "Candidate selection", "Explicit confirmation before showing secrets",
"Payload-aware display" and "Vault listing mode", and the display-time rules from the task 1.1 review:
strip Cc, Cf, Zl and Zp from names and labels, and print with backslashreplace (v1 lone surrogates).
"""

from __future__ import annotations

import io
import logging
import os
from pathlib import Path
from typing import Any

import pytest
from support import writer
from support.fakes import FakeChain
from support.keys import BY_NAME, FakePrfSource, PhysicalKey
from support.vectors import h
from test_recover import RecUI, cfg_for

from cryoshield_recover import cli, payload, vault
from cryoshield_recover import recover as recover_mod
from cryoshield_recover.errors import ExitCode, RecoveryError
from cryoshield_recover.format import MODE_ANY_OF_N
from cryoshield_recover.payload import Item, VaultPayload
from cryoshield_recover.recover import Recovery
from cryoshield_recover.ui import Console

LOC_A, LOC_B = h(BY_NAME["A"]["locator"]), h(BY_NAME["B"]["locator"])
VID_WORK = b"\x11" * 32
VID_FAMILY = b"\x22" * 32
VID_NEW = b"\x33" * 32
WORK = VaultPayload(1, None, False, [Item("Bitcoin seed", "abandon about")], None)
FAMILY = VaultPayload(2, "Family", True, [Item("GitHub codes", "1a2b3-c4d5e\n6f7g8"), Item("Email", "JBSW")])
SECRETS = ["abandon about", "1a2b3-c4d5e", "6f7g8", "JBSW"]
LABELS = ["Bitcoin seed", "GitHub codes", "Email"]


def blob_for(vid: bytes, data: bytes, keys: tuple[str, ...] = ("A", "B")) -> bytes:
    creds = [(h(BY_NAME[k]["id"]), bytearray(h(BY_NAME[k]["prf"]))) for k in keys]
    return writer.create(
        vault_id=vid,
        rp_id="cryoshield.app",
        credentials=creds,
        secret=data,
        mode=MODE_ANY_OF_N,
        threshold=1,
        rng=writer.FixedRng(os.urandom(400)),
    )


@pytest.fixture
def two() -> Any:
    """Key A opens two vaults: an unnamed v1 vault and a named, archived v2 vault."""
    with FakeChain() as c:
        c.add_vault(VID_WORK, blob_for(VID_WORK, payload.write(WORK)), [LOC_A, LOC_B])
        c.add_vault(VID_FAMILY, blob_for(VID_FAMILY, payload.write(FAMILY)), [LOC_A, LOC_B])
        yield c


def run(cfg: Any, ui: RecUI) -> Any:
    return Recovery(cfg, FakePrfSource([PhysicalKey.named("A")], ui=ui), ui).run()


# ------------------------------------------------------------------ 5.1 grouping and choice
def test_two_vaults_interactive_lists_then_opens_the_chosen_one(two: FakeChain) -> None:
    ui = RecUI(pick=lambda options: next(i for i, o in enumerate(options) if "Family" in o))
    res = run(cfg_for(two, use_arweave=False), ui)
    assert res.candidate.vault_id == VID_FAMILY
    assert payload.decode(bytes(res.secret)).name == "Family"
    (options,) = ui.choices
    assert len(options) == 2
    text = "\n".join(options)
    assert "Unnamed vault" in text and "Family" in text and "[ARCHIVED]" in text
    assert VID_WORK.hex()[:8] in text and VID_FAMILY.hex()[:8] in text
    assert not any(s in text for s in SECRETS)


def test_two_vaults_non_interactive_is_ambiguous_with_ids_and_status_only(two: FakeChain) -> None:
    with pytest.raises(RecoveryError) as ei:
        run(cfg_for(two, use_arweave=False), RecUI())
    assert ei.value.exit_code == ExitCode.AMBIGUOUS
    msg = ei.value.message
    assert f"0x{VID_WORK.hex()}" in msg and f"0x{VID_FAMILY.hex()}" in msg
    assert "current" in msg and "archived" in msg and "--vault-id" in msg
    assert "Family" not in msg and not any(x in msg for x in SECRETS + LABELS)


def test_vault_id_selects_without_a_choice(two: FakeChain) -> None:
    ui = RecUI()
    res = run(cfg_for(two, use_arweave=False, vault_id=VID_FAMILY), ui)
    assert res.candidate.vault_id == VID_FAMILY and ui.choices == []


def test_copies_of_one_vault_are_one_entry() -> None:
    with FakeChain() as a, FakeChain() as b:
        data = blob_for(VID_WORK, payload.write(WORK))
        for c in (a, b):
            c.add_vault(VID_WORK, data, [LOC_A])
        cfg = cfg_for(a, use_arweave=False)
        cfg.rpcs = [a.url, b.url]
        ui = RecUI()
        res = run(cfg, ui)
    assert res.candidate.vault_id == VID_WORK and ui.choices == []


def test_unchosen_vaults_are_wiped(two: FakeChain, monkeypatch: pytest.MonkeyPatch) -> None:
    made: list[bytearray] = []
    real = recover_mod.open_decoded

    def spy(*a: Any, **k: Any) -> bytearray:
        out = real(*a, **k)
        made.append(out)
        return out

    monkeypatch.setattr(recover_mod, "open_decoded", spy)
    ui = RecUI(pick=lambda options: 0)
    res = run(cfg_for(two, use_arweave=False), ui)
    others = [b for b in made if b is not res.secret]
    assert others and all(b == bytearray(len(b)) for b in others)


# ------------------------------------------------------------------ CLI display (5.1, 5.3)
def term(answer: str, interactive: bool = True) -> tuple[Console, io.StringIO, io.StringIO]:
    out, err = io.StringIO(), io.StringIO()
    return (
        Console(io.StringIO(answer), out, err, getpass_fn=lambda _p: "1", interactive=interactive),
        out,
        err,
    )


def main(
    chain: FakeChain, *extra: str, answer: str = "show\n", interactive: bool = True
) -> tuple[int, str, str]:
    console, out, err = term(answer, interactive)
    args = [
        "--rpc",
        chain.url,
        "--registries-only",
        "--registry",
        f"{chain.address}@0:v1",
        "--no-arweave",
        *extra,
    ]
    code = cli.main(
        args, console=console, prf_factory=lambda u: FakePrfSource([PhysicalKey.named("A")], ui=u)
    )
    return code, out.getvalue(), err.getvalue()


def single(data: bytes) -> FakeChain:
    c = FakeChain()
    c.add_vault(VID_NEW, blob_for(VID_NEW, data), [LOC_A, LOC_B])
    return c


def test_structured_display_after_confirmation(two: FakeChain) -> None:
    code, out, err = main(two, answer="2\nshow\n")
    assert code == ExitCode.OK, err
    assert "Vault: Family [ARCHIVED]" in out
    assert "GitHub codes:\n1a2b3-c4d5e\n6f7g8" in out and "Email: JBSW" in out
    # Names and labels may appear before the confirmation; secret values never do.
    before = err.split('Type "show"')[0]
    assert "Family" in before and "GitHub codes" in before
    assert not any(s in err for s in SECRETS)


def test_declined_shows_no_secret(two: FakeChain) -> None:
    code, out, err = main(two, answer="1\nno\n")
    assert code == ExitCode.OK
    assert not any(s in out + err for s in SECRETS)


def test_unknown_version_falls_back_to_raw_text() -> None:
    raw = b'{"v":3,"items":[{"l":"x","s":"future secret"}]}'
    with single(raw) as c:
        code, out, err = main(c)
    assert code == ExitCode.OK, err
    assert "future secret" in out and "newer version" in err


def test_malformed_payload_falls_back_to_raw_text() -> None:
    with single(b"just a plain old secret") as c:
        code, out, err = main(c)
    assert code == ExitCode.OK, err
    assert "just a plain old secret" in out


def test_names_and_labels_are_made_inert() -> None:
    hostile = VaultPayload(1, None, False, [Item("‮evil\x1b[31m x​", "s\x1b]0;t\x07‮q")], None)
    with single(payload.write(hostile)) as c:
        code, out, err = main(c)
    assert code == ExitCode.OK, err
    assert "evil[31mx:" in out
    for bad in ("‮", "\x1b", " ", "​", "\x07"):
        assert bad not in out and bad not in err
    assert "s\\u001b]0;t\\u0007\\u202eq" in out  # the secret is shown exactly, escaped


def test_lone_surrogates_print_with_backslashreplace() -> None:
    with single(b'{"v":1,"items":[{"l":"a\\ud800","s":"b\\udc00"}]}') as c:
        code, out, err = main(c)
    assert code == ExitCode.OK, err
    assert "a\\ud800: b\\udc00" in out


def test_invisible_name_is_unnamed() -> None:
    with single(payload.write(VaultPayload(2, "‍‌", False, [Item("a", "b")]))) as c:
        code, out, err = main(c)
    assert code == ExitCode.OK, err
    assert "Vault: Unnamed vault" in out


def test_cleared_vault_is_shown_as_empty() -> None:
    cleared = payload.archive_clear(payload.write(FAMILY), 638)
    with single(cleared) as c:
        code, out, err = main(c)
    assert code == ExitCode.OK, err
    assert "Vault: Family [ARCHIVED]" in out and "(no items)" in out


# ------------------------------------------------------------------ 5.2 --list
def test_list_prints_summaries_and_no_secrets(two: FakeChain) -> None:
    code, out, err = main(two, "--list", answer="")
    assert code == ExitCode.OK, err
    assert f"0x{VID_WORK.hex()}" in out and f"0x{VID_FAMILY.hex()}" in out
    assert "Unnamed vault" in out and "Family" in out and "[ARCHIVED]" in out
    assert "1 item" in out and "2 items" in out and "any 1 of 2 keys" in out and "current" in out
    assert not any(x in out + err for x in SECRETS + LABELS)


def test_list_in_a_pipe(two: FakeChain) -> None:
    code, out, err = main(two, "--list", answer="", interactive=False)
    assert code == ExitCode.OK, err
    assert out.count("0x") >= 2


def test_list_refuses_output_flags(two: FakeChain, tmp_path: Path) -> None:
    code, _, err = main(two, "--list", "--output", str(tmp_path / "x"))
    assert code == ExitCode.USAGE and "--list" in err


def test_list_and_verbose_never_log_labels_or_secrets(
    two: FakeChain, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG, logger="cryoshield_recover")
    code, out, err = main(two, "--list", "--verbose", answer="")
    assert code == ExitCode.OK
    logged = caplog.text + err
    assert not any(x in logged for x in SECRETS + LABELS)
    code, out, err = main(two, "--verbose", answer="2\nno\n")
    assert code == ExitCode.OK
    assert not any(x in caplog.text + err + out for x in SECRETS)
    assert not any(x in caplog.text for x in LABELS + ["Family"])


def test_non_interactive_two_vaults_exit_12_without_plaintext(two: FakeChain, tmp_path: Path) -> None:
    target = tmp_path / "secret.txt"
    code, out, err = main(two, "--output", str(target), answer="", interactive=False)
    assert code == ExitCode.AMBIGUOUS
    assert not target.exists()
    assert not any(x in out + err for x in SECRETS + LABELS + ["Family"])


def test_all_decrypted_buffers_are_wiped_after_main(two: FakeChain, monkeypatch: pytest.MonkeyPatch) -> None:
    made: list[bytearray] = []
    real = vault.open_decoded

    def spy(*a: Any, **k: Any) -> bytearray:
        out = real(*a, **k)
        made.append(out)
        return out

    monkeypatch.setattr(recover_mod, "open_decoded", spy)
    for extra, answer in ((("--list",), ""), ((), "2\nshow\n"), ((), "1\nno\n")):
        made.clear()
        main(two, *extra, answer=answer)
        assert made and all(b == bytearray(len(b)) for b in made), extra

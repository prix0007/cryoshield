"""Every vault a key opens, payload-aware display and --list (vault-list-labels-archive tasks 5.1-5.2).

The vault-recovery deltas "Candidate selection", "Explicit confirmation before showing secrets",
"Payload-aware display" and "Vault listing mode", and the display-time rules from the task 1.1 review:
strip Cc, Cf, Zl and Zp from names and labels, and print with backslashreplace (v1 lone surrogates).
"""

from __future__ import annotations

import io
import logging
import os
import re
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
    assert "name: Unnamed vault" in text and 'name: "Family"' in text and "[ARCHIVED]" in text
    assert all(re.match(r" ?\d+\. \[(ACTIVE  |ARCHIVED)\] 0x", o) for o in options)  # status first, fixed
    assert VID_WORK.hex()[:8] in text and VID_FAMILY.hex()[:8] in text
    assert not any(s in text for s in SECRETS)


def test_two_vaults_non_interactive_is_ambiguous_with_ids_and_status_only(two: FakeChain) -> None:
    with pytest.raises(RecoveryError) as ei:
        run(cfg_for(two, use_arweave=False), RecUI())
    assert ei.value.exit_code == ExitCode.AMBIGUOUS
    msg = ei.value.message
    assert f"0x{VID_WORK.hex()}" in msg and f"0x{VID_FAMILY.hex()}" in msg
    assert "current" in msg and "--vault-id" in msg
    assert "archived" not in msg.lower() and "active" not in msg.lower()  # ID and freshness only
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
    assert '(status: ARCHIVED; vault: "Family")' in out
    assert "  - GitHub codes:\n    | 1a2b3-c4d5e\n    | 6f7g8" in out and "  - Email: JBSW" in out
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
    hostile = VaultPayload(
        1, None, False, [Item("\u202eevil\x1b[31m\u2028x\u200b", "s\x1b]0;t\x07\u202eq")], None
    )
    with single(payload.write(hostile)) as c:
        code, out, err = main(c)
    assert code == ExitCode.OK, err
    assert "evil[31mx:" in out
    for bad in ("\u202e", "\x1b", "\u2028", "\u200b", "\x07"):
        assert bad not in out and bad not in err
    assert "s\\u001b]0;t\\u0007\\u202eq" in out  # the secret is shown exactly, escaped
    assert "use --output for the exact bytes" in err


def test_lone_surrogates_print_with_backslashreplace() -> None:
    with single(b'{"v":1,"items":[{"l":"a\\ud800","s":"b\\udc00"}]}') as c:
        code, out, err = main(c)
    assert code == ExitCode.OK, err
    assert "a\\ud800: b\\udc00" in out
    assert "use --output for the exact bytes" in err


def test_invisible_name_is_unnamed() -> None:
    with single(payload.write(VaultPayload(2, "\u200d\u200c", False, [Item("a", "b")]))) as c:
        code, out, err = main(c)
    assert code == ExitCode.OK, err
    assert "vault: Unnamed vault)" in out


def test_cleared_vault_is_shown_as_empty() -> None:
    cleared = payload.archive_clear(payload.write(FAMILY), 638)
    with single(cleared) as c:
        code, out, err = main(c)
    assert code == ExitCode.OK, err
    assert '(status: ARCHIVED; vault: "Family")' in out and "(no items)" in out


# ------------------------------------------------------------------ 5.2 --list
def test_list_prints_summaries_and_no_secrets(two: FakeChain) -> None:
    code, out, err = main(two, "--list", answer="")
    assert code == ExitCode.OK, err
    assert f"0x{VID_WORK.hex()}" in out and f"0x{VID_FAMILY.hex()}" in out
    assert "name: Unnamed vault" in out and 'name: "Family"' in out and "status: ARCHIVED, current" in out
    assert "status: ACTIVE, current" in out
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


# ------------------------------------------------------------------ ECC review of c9830c1
def test_list_merges_chain_and_arweave() -> None:
    """M1: a vault mirrored only on Arweave is listed next to the chain vault."""
    from support.fakes import FakeArweave

    with FakeChain() as c, FakeArweave() as ar:
        c.add_vault(VID_WORK, blob_for(VID_WORK, payload.write(WORK)), [LOC_A, LOC_B])
        ar.mirror(blob_for(VID_FAMILY, payload.write(FAMILY)), vault_id=VID_FAMILY, locators=[LOC_A])
        console, out, err = term("")
        args = ["--rpc", c.url, "--registries-only", "--registry", f"{c.address}@0:v1", "--list"]
        args += ["--arweave-graphql", ar.graphql_url, "--arweave-gateway", ar.url]
        code = cli.main(
            args, console=console, prf_factory=lambda u: FakePrfSource([PhysicalKey.named("A")], ui=u)
        )
    assert code == ExitCode.OK, err.getvalue()
    assert f"0x{VID_WORK.hex()}" in out.getvalue() and f"0x{VID_FAMILY.hex()}" in out.getvalue()


def test_list_warns_when_arweave_is_unreachable(two: FakeChain) -> None:
    console, out, err = term("")
    args = ["--rpc", two.url, "--registries-only", "--registry", f"{two.address}@0:v1", "--list"]
    args += ["--arweave-graphql", "http://127.0.0.1:9/graphql", "--arweave-gateway", "http://127.0.0.1:9"]
    code = cli.main(
        args, console=console, prf_factory=lambda u: FakePrfSource([PhysicalKey.named("A")], ui=u)
    )
    assert code == ExitCode.OK, err.getvalue()
    assert "may be incomplete" in err.getvalue() and out.getvalue().count("0x") >= 2


def test_status_first_and_quoted_name_defeat_spoofing() -> None:
    """M2: a name that looks like a status can't pass as one."""
    spoof = VaultPayload(2, "x [ARCHIVED]", False, [Item("a", "b")])
    with FakeChain() as c:
        c.add_vault(VID_WORK, blob_for(VID_WORK, payload.write(spoof)), [LOC_A])
        c.add_vault(VID_FAMILY, blob_for(VID_FAMILY, payload.write(FAMILY)), [LOC_A])
        ui = RecUI(pick=lambda options: 0)
        run(cfg_for(c, use_arweave=False), ui)
        code, out, err = main(c, "--list", answer="")
    first = ui.choices[0][0]
    assert first.lstrip().startswith("1. [ACTIVE  ]") and first.endswith('name: "x [ARCHIVED]"')
    assert (
        'status: ACTIVE, current\n  source: built-in registry v1\n  1 item, any 1 of 2 keys\n  name: "x [ARCHIVED]"'
        in out
    )


@pytest.mark.parametrize(
    "name",
    ["\u3164", "\u2800", "\u115f\u1160", "\u17b4\u17b5", "\ufe0f", "   ", "\u200d", "\u3164\u0301"],
)
def test_blank_looking_names_are_unnamed(name: str) -> None:
    with single(payload.write(VaultPayload(2, name, False, [Item("a", "b")]))) as c:
        code, out, err = main(c)
    assert code == ExitCode.OK, err
    assert "vault: Unnamed vault)" in out


def test_combining_runs_are_capped_and_joiners_kept() -> None:
    zalgo = "e" + "\u0301" * 20
    family = "\U0001f468\u200d\U0001f469"
    for name, expected in ((zalgo, '"e' + "\u0301" * 3 + '"'), (family, f'"{family}"')):
        with single(payload.write(VaultPayload(2, name, False, [Item("a", "b")]))) as c:
            code, out, err = main(c)
        assert code == ExitCode.OK, err
        assert f"vault: {expected})" in out


def test_outdated_copy_is_marked_in_list_and_chooser() -> None:
    """M4: a copy that isn't confirmed current says so."""
    with FakeChain() as c, FakeChain() as dead:
        dead.down = True
        c.add_vault(VID_WORK, blob_for(VID_WORK, payload.write(WORK)), [LOC_A])
        c.add_vault(VID_FAMILY, blob_for(VID_FAMILY, payload.write(FAMILY)), [LOC_A])
        cfg = cfg_for(c, use_arweave=False)
        cfg.rpcs = [c.url, dead.url]  # quorum 2, one answers: not confirmed current
        ui = RecUI(pick=lambda options: 0)
        run(cfg, ui)
        console, out, err = term("")
        args = ["--rpc", c.url, "--rpc", dead.url, "--registries-only", "--registry", f"{c.address}@0:v1"]
        code = cli.main(
            [*args, "--no-arweave", "--list"],
            console=console,
            prf_factory=lambda u: FakePrfSource([PhysicalKey.named("A")], ui=u),
        )
    assert all("(may be outdated)" in o for o in ui.choices[0])
    assert code == ExitCode.OK and out.getvalue().count("(may be outdated)") == 2


def test_rivals_across_several_vaults_are_one_entry_each() -> None:
    """Two RPCs serve different decrypting copies of each vault: still one chooser entry per vault."""
    with FakeChain() as a, FakeChain() as b:
        for c in (a, b):  # independent encryptions: different blobs, same vaults
            c.add_vault(VID_WORK, blob_for(VID_WORK, payload.write(WORK)), [LOC_A])
            c.add_vault(VID_FAMILY, blob_for(VID_FAMILY, payload.write(FAMILY)), [LOC_A])
        cfg = cfg_for(a, use_arweave=False)
        cfg.rpcs = [a.url, b.url]
        ui = RecUI(pick=lambda options: 0)
        res = run(cfg, ui)
    assert len(ui.choices[0]) == 2  # the vault chooser
    assert res.candidate.vault_id in (VID_WORK, VID_FAMILY)
    assert len(ui.choices) == 2 and len(ui.choices[1]) == 2  # then the copy (tie) chooser


def test_threshold_vault_is_listed_as_locked(two: FakeChain) -> None:
    from test_recover import SH

    two.add_vault(h(SH["vaultId"]), h(SH["blob"]), [LOC_A])
    code, out, err = main(two, "--list", answer="")
    assert code == ExitCode.OK, err
    assert f"0x{SH['vaultId']}" in out and "status: LOCKED" in out and "needs 2 of 3 keys" in out


@pytest.mark.parametrize("answer", ["9\n", "0\n", "\u0661\n", "x\n"])
def test_bad_choice_is_cancelled(two: FakeChain, answer: str) -> None:
    code, out, err = main(two, answer=answer)
    assert code == ExitCode.CANCELLED and "no choice made" in err
    assert not any(s in out + err for s in SECRETS)


def test_describe_caps_labels_before_confirmation() -> None:
    many = VaultPayload(1, None, False, [Item(f"label {i:02d} " + "x" * 16, f"s{i}") for i in range(13)])
    with single(payload.write(many)) as c:
        code, out, err = main(c, answer="no\n")
    assert code == ExitCode.OK
    items = next(line for line in err.splitlines() if line.startswith("Items: "))
    assert items.count("label") == 10 and items.endswith("+3 more")
    assert "label 00 " + "x" * 14 + "…" in items  # 24 code points


def test_backslash_in_a_secret_is_escaped() -> None:
    with single(payload.write(VaultPayload(1, None, False, [Item("path", "C:\\new")]))) as c:
        code, out, err = main(c)
    assert code == ExitCode.OK
    assert "  - path: C:\\\\new" in out and "use --output for the exact bytes" in err


def test_decrypted_buffers_are_decoded_in_place(two: FakeChain, monkeypatch: pytest.MonkeyPatch) -> None:
    """M3: payload.decode always gets the decrypted bytearray itself, never a bytes() copy."""
    from cryoshield_recover import ui as ui_mod

    seen: list[Any] = []
    real = payload.decode

    def spy(data: Any) -> Any:
        seen.append(data)
        return real(data)

    monkeypatch.setattr(payload, "decode", spy)
    monkeypatch.setattr(ui_mod, "decode", spy)
    for extra, answer in ((("--list",), ""), ((), "2\nshow\n")):
        seen.clear()
        main(two, *extra, answer=answer)
        assert seen and all(type(d) is bytearray for d in seen), extra


def test_open_all_wipes_on_interrupt(two: FakeChain, monkeypatch: pytest.MonkeyPatch) -> None:
    made: list[bytearray] = []
    real = recover_mod.open_decoded

    def flaky(*a: Any, **k: Any) -> bytearray:
        if made:
            raise KeyboardInterrupt
        made.append(real(*a, **k))
        return made[-1]

    monkeypatch.setattr(recover_mod, "open_decoded", flaky)
    with pytest.raises(KeyboardInterrupt):
        run(cfg_for(two, use_arweave=False), RecUI(pick=lambda o: 0))
    assert made and made[0] == bytearray(len(made[0]))


def test_vault_id_mode_tries_every_rp_id() -> None:
    """M1: copies of one vault created for two sites are both tried (not only the first RP group)."""
    from support.fakes import FakeArweave

    other = writer.create(
        vault_id=VID_WORK,
        rp_id="other.example",
        credentials=[(h(BY_NAME[k]["id"]), bytearray(h(BY_NAME[k]["prf"]))) for k in ("A", "B")],
        secret=payload.write(WORK),
        mode=MODE_ANY_OF_N,
        threshold=1,
        rng=writer.FixedRng(os.urandom(400)),
    )
    with FakeChain() as c, FakeArweave() as ar:
        c.add_vault(VID_WORK, blob_for(VID_WORK, payload.write(WORK)), [LOC_A])
        ar.mirror(other, vault_id=VID_WORK, locators=[LOC_A])
        a = BY_NAME["A"]
        key = PhysicalKey([(rp, h(a["id"]), h(a["prf"]), True) for rp in ("cryoshield.app", "other.example")])
        ui = RecUI()
        prf = FakePrfSource([key], ui=ui)
        res = Recovery(cfg_for(c, ar, vault_id=VID_WORK), prf, ui).run()
    assert res.candidate.vault_id == VID_WORK
    assert {rp for rp, _ in prf.calls} == {"cryoshield.app", "other.example"}

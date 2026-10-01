"""Secret buffers are wiped on success and on failure; no secret ever reaches logging (task 5.4)."""

from __future__ import annotations

import ast
import logging
from pathlib import Path

import pytest
from support import vectors
from support.vectors import h

from cryoshield_recover import derive, vault
from cryoshield_recover.errors import VaultError
from cryoshield_recover.format import decode_blob
from cryoshield_recover.vault import UnlockKey, open_vault, select_vault

V = vectors.cases("vaults")[0]
VID = h(V["vaultId"])
SRC = Path(__file__).resolve().parents[1] / "src" / "cryoshield_recover"


def test_open_wipes_prf_on_success() -> None:
    key = UnlockKey(bytearray(h(V["credentials"][0]["prf"])))
    assert bytes(open_vault(h(V["blob"]), [key], VID)) == h(V["secret"])
    assert key.prf == bytearray(32)


def test_open_wipes_prf_on_failure() -> None:
    key = UnlockKey(bytearray(b"\x42" * 32))
    with pytest.raises(VaultError):
        open_vault(h(V["blob"]), [key], VID)
    assert key.prf == bytearray(32)


def test_open_wipes_prf_on_decode_failure() -> None:
    key = UnlockKey(bytearray(b"\x42" * 32))
    with pytest.raises(VaultError):
        open_vault(b"garbage", [key], VID)
    assert key.prf == bytearray(32)


def test_select_wipes_prf_both_ways() -> None:
    prf = bytearray(h(V["credentials"][1]["prf"]))
    select_vault([(VID, h(V["blob"]))], prf)
    assert prf == bytearray(32)
    prf = bytearray(h(V["credentials"][1]["prf"]))
    with pytest.raises(VaultError):
        select_vault([(VID, b"junk")], prf)
    assert prf == bytearray(32)


def test_intermediate_wrap_keys_and_data_keys_are_wiped(monkeypatch: pytest.MonkeyPatch) -> None:
    created: list[bytearray] = []
    real = vault.derive_wrap_key

    def spy(prf: bytearray, salt: bytes) -> bytearray:
        out = real(prf, salt)
        created.append(out)
        return out

    monkeypatch.setattr(vault, "derive_wrap_key", spy)
    real_data_key = vault._data_key
    data_keys: list[bytearray] = []

    def spy_dk(d: object, keys: object, vid: bytes) -> bytearray:
        out = real_data_key(d, keys, vid)  # type: ignore[arg-type]
        data_keys.append(out)
        return out

    monkeypatch.setattr(vault, "_data_key", spy_dk)
    key = UnlockKey(bytearray(h(V["credentials"][0]["prf"])))
    vault.open_decoded(decode_blob(h(V["blob"])), [key], VID)
    assert created and all(b == bytearray(len(b)) for b in created)
    assert data_keys and all(b == bytearray(len(b)) for b in data_keys)


def test_derive_helpers_do_not_touch_input() -> None:
    prf = bytearray(h(V["credentials"][0]["prf"]))
    derive.derive_locator(prf)
    wk = derive.derive_wrap_key(prf, h(V["wrapSalt"]))
    assert prf == bytearray(h(V["credentials"][0]["prf"]))
    assert isinstance(wk, bytearray)


def test_no_logging_in_crypto_modules() -> None:
    """Crypto modules must not log at all; logging lives in the orchestration layer only."""
    for name in ("derive.py", "format.py", "vault.py", "shamir.py", "authdata.py"):
        tree = ast.parse((SRC / name).read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.Import | ast.ImportFrom):
                mods = [a.name for a in node.names] + (
                    [node.module] if isinstance(node, ast.ImportFrom) else []
                )
                assert "logging" not in mods, f"{name} imports logging"
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                assert node.func.id != "print", f"{name} calls print"


def test_open_emits_no_log_records(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    key = UnlockKey(bytearray(h(V["credentials"][0]["prf"])))
    open_vault(h(V["blob"]), [key], VID)
    assert caplog.records == []


def test_secure_logs_only_core_dump_failures() -> None:
    """secure.py may log exactly one thing: that core dumps could not be disabled (no values)."""
    tree = ast.parse((SRC / "secure.py").read_text())
    for fn in [n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)]:
        calls = [c for c in ast.walk(fn) if isinstance(c, ast.Call) and isinstance(c.func, ast.Attribute)]
        if any(isinstance(c.func.value, ast.Name) and c.func.value.id == "log" for c in calls):
            assert fn.name == "disable_core_dumps", fn.name

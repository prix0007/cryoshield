"""Payload codec v1 + v2 against the shared vectors (OpenSpec change vault-list-labels-archive, task 1.3).

``docs/spec/payload-vectors.json`` is normative and shared with the web app's TypeScript codec. It is
pinned by SHA-256: a change to it is a format change and must come through a reviewed OpenSpec change.
"""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from typing import Any

import pytest
from support.vectors import REPO_ROOT

from cryoshield_recover import payload
from cryoshield_recover.payload import Item, PayloadError, VaultPayload
from cryoshield_recover.vault import UnlockKey, open_vault

VECTORS_PATH = REPO_ROOT / "docs" / "spec" / "payload-vectors.json"
# Pinned (PR #47). Update only after re-reading docs/spec/payload-v2.md and the vector diff.
PINNED_SHA256 = "e2bfda8dbf1a6d08a4f0cebf1ae01af054f8b6e707f95e7926f7c61eb3fc54d7"


@lru_cache(maxsize=1)
def vectors() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(VECTORS_PATH.read_bytes())
    return data


def cases(section: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = vectors()[section]
    return out


def ids(section: str) -> list[str]:
    return [c["id"] for c in cases(section)]


def as_dict(p: VaultPayload) -> dict[str, Any]:
    return {
        "version": p.version,
        "name": p.name,
        "archived": p.archived,
        "items": [{"l": i.l, "s": i.s} for i in p.items],
        "pad": p.pad,
    }


def from_dict(d: dict[str, Any], version: int = 0) -> VaultPayload:
    return VaultPayload(
        version or d.get("version", 0),
        d["name"],
        d["archived"],
        [Item(i["l"], i["s"]) for i in d["items"]],
        d["pad"],
    )


def test_vectors_file_is_pinned() -> None:
    assert hashlib.sha256(VECTORS_PATH.read_bytes()).hexdigest() == PINNED_SHA256


def test_vector_counts() -> None:
    v = vectors()
    assert v["formatVersion"] == 2
    assert len(v["positive"]) >= 40 and len(v["negative"]) >= 100
    assert v["writer"] and v["archiveClear"] and v["blobs"]


@pytest.mark.parametrize("case", cases("positive"), ids=ids("positive"))
def test_positive_decodes_and_reencodes(case: dict[str, Any]) -> None:
    decoded = payload.decode(bytes.fromhex(case["hex"]))
    assert as_dict(decoded) == case["decoded"]
    assert payload.encode(decoded).hex() == case["canonicalHex"]


@pytest.mark.parametrize("case", cases("negative"), ids=ids("negative"))
def test_negative_is_refused_with_its_class(case: dict[str, Any]) -> None:
    with pytest.raises(PayloadError) as ei:
        payload.decode(bytes.fromhex(case["hex"]))
    assert ei.value.code == case["error"]


@pytest.mark.parametrize("case", cases("writer"), ids=ids("writer"))
def test_writer_minimal_version(case: dict[str, Any]) -> None:
    out = payload.write(from_dict(case["input"]))
    assert out.hex() == case["expectedHex"]
    assert payload.decode(out).version == case["expectedVersion"]


@pytest.mark.parametrize("case", cases("archiveClear"), ids=ids("archiveClear"))
def test_archive_clear(case: dict[str, Any]) -> None:
    out = payload.archive_clear(bytes.fromhex(case["previousHex"]), case["maxPayloadBytes"])
    assert out.hex() == case["expectedHex"]
    assert len(out) == case["expectedLength"]


@pytest.mark.parametrize("case", cases("blobs"), ids=ids("blobs"))
def test_blobs_open_to_their_payload(case: dict[str, Any]) -> None:
    by_id = {c["id"]: c for c in cases("positive")}
    vid = bytes.fromhex(case["vaultId"])
    for cred in case["credentials"]:
        key = UnlockKey(bytearray(bytes.fromhex(cred["prf"])), bytes.fromhex(cred["id"]))
        secret = open_vault(bytes.fromhex(case["blob"]), [key], vid)
        assert bytes(secret).hex() == case["payloadHex"]
        ref = case["payloadVector"]
        if ref in by_id:
            assert as_dict(payload.decode(bytes(secret))) == by_id[ref]["decoded"]
        else:  # an archiveClear output
            (clear,) = [c for c in cases("archiveClear") if c["id"] == ref]
            assert case["payloadHex"] == clear["expectedHex"]
            assert payload.decode(bytes(secret)).archived


# ------------------------------------------------------------------ properties the spec calls out
def test_a_must_be_a_real_bool() -> None:
    """Python treats 1 == True; the codec must not (spec 7.2)."""
    with pytest.raises(PayloadError) as ei:
        payload.decode(b'{"v":2,"a":1,"items":[]}')
    assert ei.value.code == "MALFORMED"
    with pytest.raises(PayloadError):
        payload.decode(b'{"v":true,"items":[{"l":"a","s":"b"}]}')


def test_v1_duplicates_last_wins_and_one_bom_is_stripped() -> None:
    p = payload.decode(b'{"v":1,"items":[{"l":"x","s":"y"}],"items":[{"l":"a","s":"b"}]}')
    assert [(i.l, i.s) for i in p.items] == [("a", "b")]
    assert payload.decode(b"\xef\xbb\xbf" + b'{"v":1,"items":[{"l":"a","s":"b"}]}').version == 1
    with pytest.raises(PayloadError):
        payload.decode(b"\xef\xbb\xbf\xef\xbb\xbf" + b'{"v":1,"items":[{"l":"a","s":"b"}]}')


def test_nesting_scan_ignores_brackets_in_strings() -> None:
    deep_in_string = '{"v":1,"items":[{"l":"' + "[" * 60 + '","s":"\\"' + "{" * 100 + '"}]}'
    assert payload.decode(deep_in_string.encode()).items[0].l == "[" * 60
    deep = '{"v":3,"x":' + "[" * 64 + "]" * 64 + "}"
    with pytest.raises(PayloadError) as ei:
        payload.decode(deep.encode())
    assert ei.value.code == "MALFORMED"


def test_huge_nesting_never_raises_recursion_error() -> None:
    with pytest.raises(PayloadError):
        payload.decode(b"[" * 200_000)


def test_nan_and_infinity_are_malformed() -> None:
    for text in (b'{"v":NaN,"items":[]}', b'{"v":Infinity,"items":[]}'):
        with pytest.raises(PayloadError) as ei:
            payload.decode(text)
        assert ei.value.code == "MALFORMED"


def test_v2_writer_refuses_ill_formed_strings_and_bad_names() -> None:
    with pytest.raises(ValueError):
        payload.write(VaultPayload(0, "Work", False, [Item("a", "\udc00")], None))
    with pytest.raises(ValueError):
        payload.write(VaultPayload(0, "bad‮name", False, [Item("a", "b")], None))

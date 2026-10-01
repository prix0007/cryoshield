"""The vector file is present and exactly the reviewed version (task 2.1). Never skipped."""

from __future__ import annotations

from support import vectors


def test_vector_file_exists() -> None:
    assert vectors.VECTORS_PATH.is_file(), f"missing {vectors.VECTORS_PATH}"


def test_vector_file_pinned() -> None:
    assert vectors.sha256_of_file() == vectors.PINNED_SHA256, (
        "v1.json changed: re-review it against docs/spec/vault-format-v1.md, then update PINNED_SHA256"
    )


def test_vector_metadata() -> None:
    d = vectors.load()
    assert d["name"] == "cryoshield-vault-v1"
    assert d["formatVersion"] == 1
    assert d["constants"]["userVerification"] == "required"
    assert d["constants"]["shamirField"] == "GF(2^8) mod 0x11B"

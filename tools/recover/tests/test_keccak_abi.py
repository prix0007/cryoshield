"""Keccak-256 and the minimal ABI codec (tasks 6.1, 6.2)."""

from __future__ import annotations

import json

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from support.vectors import REPO_ROOT

from cryoshield_recover import abi
from cryoshield_recover.keccak import keccak256

ABI_JSON = REPO_ROOT / "contracts" / "abi" / "VaultRegistry.json"


@pytest.mark.parametrize(
    ("data", "digest"),
    [
        (b"", "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"),
        (b"abc", "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"),
        (bytes(range(200)), "bfb0aa97863e797943cf7c33bb7e880bb4543f3d2703c0923c6901c2af57b890"),
    ],
)
def test_keccak_vectors(data: bytes, digest: str) -> None:
    assert keccak256(data).hex() == digest


def test_keccak_block_boundaries() -> None:
    # 135/136/137 bytes straddle the 136-byte rate; must differ and be stable.
    outs = {keccak256(b"\x61" * n) for n in (135, 136, 137, 272)}
    assert len(outs) == 4


def _abi_entries() -> list[dict[str, object]]:
    data = json.loads(ABI_JSON.read_text())
    return data["abi"] if isinstance(data, dict) else data  # type: ignore[no-any-return]


def _sig(entry: dict[str, object]) -> str:
    inputs = entry["inputs"]
    assert isinstance(inputs, list)
    return f"{entry['name']}({','.join(i['type'] for i in inputs)})"


def test_selectors_match_published_abi() -> None:
    fns = {_sig(e): e for e in _abi_entries() if e["type"] == "function"}
    assert "resolveLocator(bytes32)" in fns and "getVault(bytes32)" in fns
    assert abi.SEL_RESOLVE_LOCATOR == keccak256(b"resolveLocator(bytes32)")[:4]
    assert abi.SEL_GET_VAULT == keccak256(b"getVault(bytes32)")[:4]
    # Cross-check with Foundry's own method identifiers (`forge inspect` / cast sig).
    assert abi.SEL_RESOLVE_LOCATOR.hex() == "a6343141"
    assert abi.SEL_GET_VAULT.hex() == "b7c61f06"
    outs = fns["getVault(bytes32)"]["outputs"]
    assert [o["type"] for o in outs] == ["address", "bytes", "uint32"]  # type: ignore[union-attr,index]


def test_event_topics_match_published_abi() -> None:
    events = {_sig(e): e for e in _abi_entries() if e["type"] == "event"}
    assert "VaultCreated(bytes32,address,uint32,bytes32)" in events
    assert "VaultUpdated(bytes32,uint32,bytes32)" in events
    for name in ("VaultCreated(bytes32,address,uint32,bytes32)", "VaultUpdated(bytes32,uint32,bytes32)"):
        first = events[name]["inputs"][0]  # type: ignore[index]
        assert first["name"] == "vaultId" and first["indexed"] is True
    assert abi.TOPIC_VAULT_CREATED.hex() == "ce97d1455c031e2d207f467953389573a1f639ea41eac2279614dea27b5e7322"
    assert abi.TOPIC_VAULT_UPDATED.hex() == "708a8b330fade2f32683d342c347557c666ee86d0dc54d7ed55440620b5d9ba2"


def test_encode_call() -> None:
    loc = bytes(range(32))
    assert abi.encode_call(abi.SEL_RESOLVE_LOCATOR, loc) == bytes.fromhex("a6343141") + loc
    with pytest.raises(ValueError):
        abi.encode_call(abi.SEL_GET_VAULT, b"\x00" * 31)


# Fixtures produced by `cast abi-encode`.
VAULT_FIXTURE = bytes.fromhex(
    "00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8"
    "0000000000000000000000000000000000000000000000000000000000000060"
    "0000000000000000000000000000000000000000000000000000000000000007"
    "0000000000000000000000000000000000000000000000000000000000000004"
    "deadbeef00000000000000000000000000000000000000000000000000000000"
)
IDS_FIXTURE = bytes.fromhex(
    "0000000000000000000000000000000000000000000000000000000000000020"
    "0000000000000000000000000000000000000000000000000000000000000002" + "11" * 32 + "22" * 32
)


def test_decode_get_vault_fixture() -> None:
    owner, blob, version = abi.decode_vault(VAULT_FIXTURE)
    assert owner == "0x70997970c51812dc3a010c7d01b50e0d17dc79c8"
    assert blob == bytes.fromhex("deadbeef")
    assert version == 7


def test_decode_bytes32_array_fixture() -> None:
    assert abi.decode_bytes32_array(IDS_FIXTURE) == [b"\x11" * 32, b"\x22" * 32]
    empty = (32).to_bytes(32, "big") + (0).to_bytes(32, "big")
    assert abi.decode_bytes32_array(empty) == []


def _word(n: int) -> bytes:
    return n.to_bytes(32, "big")


@pytest.mark.parametrize(
    "payload",
    [
        b"",
        _word(32),  # missing length
        _word(2**200) + _word(1),  # absurd offset
        _word(32) + _word(17) + b"\x00" * 32 * 17,  # 17 candidates > 16 cap
        _word(32) + _word(3) + b"\x00" * 64,  # truncated array
        _word(64) + _word(1),  # offset past end
    ],
)
def test_bad_bytes32_array_rejected(payload: bytes) -> None:
    with pytest.raises(abi.AbiError):
        abi.decode_bytes32_array(payload)


@pytest.mark.parametrize(
    "payload",
    [
        VAULT_FIXTURE[:64],
        VAULT_FIXTURE[:32] + _word(2**64) + VAULT_FIXTURE[64:],
        VAULT_FIXTURE[:96] + _word(1025) + b"\x00" * 1056,  # blob > 1024
        VAULT_FIXTURE[:96] + _word(10**6),  # length past end (1 MB claim)
        b"\xff" * 12 + VAULT_FIXTURE[12:],  # dirty address padding
        VAULT_FIXTURE[:64] + _word(2**32) + VAULT_FIXTURE[96:],  # version overflows uint32
    ],
)
def test_bad_vault_rejected(payload: bytes) -> None:
    with pytest.raises(abi.AbiError):
        abi.decode_vault(payload)


@settings(max_examples=3_000, deadline=None)
@given(st.binary(max_size=4096))
def test_decoders_are_total(data: bytes) -> None:
    for fn in (abi.decode_bytes32_array, abi.decode_vault):
        try:
            fn(data)
        except abi.AbiError:
            pass

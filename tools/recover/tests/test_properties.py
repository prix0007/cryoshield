"""Property tests: the decoder is total, Shamir reconstructs from any M-subset (tasks 4.2, 5.2)."""

from __future__ import annotations

import itertools

from hypothesis import given, settings
from hypothesis import strategies as st
from support import vectors
from support.vectors import h

from cryoshield_recover import shamir
from cryoshield_recover.errors import VaultError
from cryoshield_recover.format import decode_blob
from cryoshield_recover.vault import UnlockKey, open_vault

VALID = [h(v["blob"]) for v in vectors.cases("vaults")]


@settings(max_examples=10_000, deadline=None)
@given(st.binary(max_size=2048))
def test_decoder_never_crashes_on_random_bytes(data: bytes) -> None:
    try:
        decode_blob(data)
    except VaultError:
        pass


@settings(max_examples=3_000, deadline=None)
@given(st.sampled_from(VALID), st.data())
def test_mutated_valid_blob_never_crashes(blob: bytes, data: st.DataObject) -> None:
    i = data.draw(st.integers(0, len(blob) - 1))
    b = data.draw(st.integers(0, 255))
    mutated = bytearray(blob)
    mutated[i] = b
    try:
        d = decode_blob(mutated)
        assert d.payload_offset <= len(mutated)
    except VaultError:
        pass


@settings(max_examples=300, deadline=None)
@given(st.sampled_from(VALID), st.data())
def test_mutated_blob_never_yields_wrong_plaintext(blob: bytes, data: st.DataObject) -> None:
    v = next(x for x in vectors.cases("vaults") if h(x["blob"]) == blob)
    i = data.draw(st.integers(0, len(blob) - 1))
    flip = data.draw(st.integers(1, 255))
    mutated = bytearray(blob)
    mutated[i] ^= flip
    keys = [UnlockKey(bytearray(h(c["prf"]))) for c in v["credentials"]]
    try:
        out = open_vault(mutated, keys, h(v["vaultId"]))
    except VaultError:
        return
    raise AssertionError(f"tampered blob opened (byte {i}): {bytes(out)[:8].hex()}")


@settings(max_examples=200, deadline=None)
@given(
    secret=st.binary(min_size=1, max_size=33),
    m=st.integers(2, 5),
    extra=st.integers(0, 3),
    data=st.data(),
)
def test_shamir_any_m_subset_reconstructs(secret: bytes, m: int, extra: int, data: st.DataObject) -> None:
    n = m + extra
    xs = data.draw(st.lists(st.integers(1, 255), min_size=n, max_size=n, unique=True))
    coeffs = [[data.draw(st.integers(0, 255)) for _ in range(m - 1)] for _ in secret]
    shares = []
    for x in xs:
        y = bytearray()
        for j, s in enumerate(secret):
            acc, xp = s, 1
            for k in range(m - 1):
                xp = shamir.gf_mul(xp, x)
                acc ^= shamir.gf_mul(coeffs[j][k], xp)
            y.append(acc)
        shares.append((x, bytes(y)))
    for subset in itertools.combinations(shares, m):
        assert bytes(shamir.combine(list(subset))) == secret


def test_gf_inverse_table() -> None:
    for a in range(1, 256):
        assert shamir.gf_mul(a, shamir.gf_inv(a)) == 1


def test_shamir_rejects_zero_and_duplicate_x() -> None:
    for bad in ([(0, b"\x01"), (1, b"\x02")], [(3, b"\x01"), (3, b"\x02")]):
        try:
            shamir.combine(bad)
        except VaultError as e:
            assert e.code == "MALFORMED"
        else:
            raise AssertionError("accepted invalid shares")

"""Shamir reconstruction over GF(2^8) mod 0x11B (docs/spec/vault-format-v1.md §6.4).

Reconstruction only: the recovery tool never splits secrets. Not constant time; it runs once, locally.
"""

from __future__ import annotations

from collections.abc import Sequence

from .errors import VaultError


def gf_mul(a: int, b: int) -> int:
    p = 0
    for _ in range(8):
        if b & 1:
            p ^= a
        hi = a & 0x80
        a = (a << 1) & 0xFF
        if hi:
            a ^= 0x1B
        b >>= 1
    return p


def gf_inv(a: int) -> int:
    if a == 0:
        raise ZeroDivisionError("no inverse of 0 in GF(2^8)")
    # a^254 = a^-1 in GF(2^8)
    result, base, e = 1, a, 254
    while e:
        if e & 1:
            result = gf_mul(result, base)
        base = gf_mul(base, base)
        e >>= 1
    return result


def combine(shares: Sequence[tuple[int, bytes | bytearray]]) -> bytearray:
    """Lagrange interpolation at x = 0 for every byte position."""
    if not shares:
        raise VaultError("INSUFFICIENT_SHARES")
    xs = [x for x, _ in shares]
    if any(x == 0 or x > 255 for x in xs) or len(set(xs)) != len(xs):
        raise VaultError("MALFORMED")
    length = len(shares[0][1])
    if any(len(y) != length for _, y in shares):
        raise VaultError("MALFORMED")
    # Basis coefficients l_i(0) = prod_{j != i} x_j / (x_j - x_i); subtraction is XOR.
    basis = []
    for i, xi in enumerate(xs):
        num, den = 1, 1
        for j, xj in enumerate(xs):
            if i != j:
                num = gf_mul(num, xj)
                den = gf_mul(den, xj ^ xi)
        basis.append(gf_mul(num, gf_inv(den)))
    out = bytearray(length)
    for (_, y), li in zip(shares, basis, strict=True):
        for k in range(length):
            out[k] ^= gf_mul(y[k], li)
    return out

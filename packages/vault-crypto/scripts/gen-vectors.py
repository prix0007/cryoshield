#!/usr/bin/env python3
"""Generate packages/vault-crypto/test-vectors/v1.json.

An independent implementation of docs/spec/vault-format-v1.md in Python,
using only the `cryptography` library (AES-GCM, HKDF) and hashlib. It shares
no code with the TypeScript library. Shamir sharing is reimplemented here from
the spec (GF(2^8)/0x11B, the shamir-secret-sharing 0.0.4 randomness order), so
the vectors cross-check the npm package, too.

All "random" values are derived deterministically from labels, so a run
regenerates byte-identical JSON.

Usage:
    python gen-vectors.py           # (re)write test-vectors/v1.json
    python gen-vectors.py --check   # exit 1 if the file differs from a fresh run
"""

from __future__ import annotations

import hashlib
import json
import struct
import sys
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

OUT = Path(__file__).resolve().parent.parent / "test-vectors" / "v1.json"

# ---------------------------------------------------------------- constants
MAGIC = b"CRYO"
VERSION = 0x01
SUITE = 0x01
MODE_ANY = 0x01
MODE_SHAMIR = 0x02
MAX_BLOB = 1024
MIN_KEYS, MAX_KEYS = 2, 8
LOCATOR_SALT_INPUT = b"cryoshield/v1/locator-salt"
INFO_LOCATOR = b"cryoshield/v1/locator"
INFO_WRAP = b"cryoshield/v1/wrap"
LOCATOR_SALT = hashlib.sha256(LOCATOR_SALT_INPUT).digest()
CTAP_SALT = hashlib.sha256(b"WebAuthn PRF" + b"\x00" + LOCATOR_SALT).digest()
USER_VERIFICATION = "required"


class VaultError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


# ---------------------------------------------------- deterministic values
def det(label: str, n: int) -> bytes:
    """Deterministic test bytes: SHA-256(prefix || label || "/" || u32be(i)) blocks."""
    out = b""
    i = 0
    while len(out) < n:
        out += hashlib.sha256(
            b"cryoshield-vectors/v1/" + label.encode() + b"/" + struct.pack(">I", i)
        ).digest()
        i += 1
    return out[:n]


def nonzero(b: bytes) -> bytes:
    """Map 0x00 -> 0x01 so the Shamir coefficient stream is valid for 0.0.3 as well as 0.0.4."""
    return bytes(x if x else 1 for x in b)


# --------------------------------------------------------------- primitives
def hkdf(ikm: bytes, salt: bytes, info: bytes) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=salt, info=info).derive(ikm)


def derive_locator(prf: bytes) -> bytes:
    return hkdf(prf, b"", INFO_LOCATOR)


def derive_wrap_key(prf: bytes, wrap_salt: bytes) -> bytes:
    return hkdf(prf, wrap_salt, INFO_WRAP)


def gcm_enc(key: bytes, nonce: bytes, aad: bytes, pt: bytes) -> bytes:
    return AESGCM(key).encrypt(nonce, pt, aad)


def gcm_dec(key: bytes, nonce: bytes, aad: bytes, ct: bytes) -> bytes | None:
    try:
        return AESGCM(key).decrypt(nonce, ct, aad)
    except InvalidTag:
        return None


# --------------------------------------------------- GF(2^8) Shamir (0x11B)
def gf_mul(a: int, b: int) -> int:
    r = 0
    while b:
        if b & 1:
            r ^= a
        a <<= 1
        if a & 0x100:
            a ^= 0x11B
        b >>= 1
    return r


def gf_inv(a: int) -> int:
    if a == 0:
        raise ZeroDivisionError
    r = 1
    for _ in range(254):  # a^254 = a^-1
        r = gf_mul(r, a)
    return r


def shamir_split(secret: bytes, n: int, m: int, stream: bytes) -> list[tuple[int, bytes]]:
    """Emulates shamir-secret-sharing 0.0.4 split() consuming `stream` as its CSPRNG."""
    pos = 0

    def take(k: int) -> bytes:
        nonlocal pos
        if pos + k > len(stream):
            raise ValueError("shamir stream exhausted")
        out = stream[pos : pos + k]
        pos += k
        return out

    coords = list(range(1, 256))
    shuffle = take(255)
    for i in range(255):
        j = shuffle[i] % 255
        coords[i], coords[j] = coords[j], coords[i]
    xs = coords[:n]
    ys = [bytearray(len(secret)) for _ in range(n)]
    degree = m - 1
    for bi, s in enumerate(secret):
        coeffs = [s] + list(take(degree))
        for si, x in enumerate(xs):
            acc = coeffs[degree]
            for c in reversed(coeffs[:degree]):
                acc = gf_mul(acc, x) ^ c
            ys[si][bi] = acc
    if pos != len(stream):
        raise ValueError("shamir stream not fully consumed")
    return [(x, bytes(y)) for x, y in zip(xs, ys)]


def shamir_combine(shares: list[tuple[int, bytes]]) -> bytes:
    xs = [x for x, _ in shares]
    if len(set(xs)) != len(xs) or 0 in xs:
        raise VaultError("MALFORMED")
    out = bytearray(len(shares[0][1]))
    for bi in range(len(out)):
        acc = 0
        for i, (xi, yi) in enumerate(shares):
            basis = 1
            for j, (xj, _) in enumerate(shares):
                if i != j:
                    basis = gf_mul(basis, gf_mul(xj, gf_inv(xi ^ xj)))
            acc ^= gf_mul(yi[bi], basis)
        out[bi] = acc
    return bytes(out)


# ------------------------------------------------------- user verification
UV_FLAG = 0x04  # authenticatorData flags byte (offset 32), bit 2


def assert_user_verified(auth_data: bytes) -> None:
    """Spec §3.1: the client MUST check UV before using any PRF output."""
    if len(auth_data) < 37:
        raise VaultError("INVALID_ARGUMENT")
    if not auth_data[32] & UV_FLAG:
        raise VaultError("USER_NOT_VERIFIED")


# ----------------------------------------------------------------- encoding
def wrapped_len(mode: int) -> int:
    return 48 if mode == MODE_ANY else 49


def fixed_header(mode: int, m: int, n: int, rp_id: bytes, wrap_salt: bytes) -> bytes:
    return MAGIC + bytes([VERSION, SUITE, mode, m, n, len(rp_id)]) + rp_id + wrap_salt


def wrap_aad(mode: int, rp_id: bytes, wrap_salt: bytes, index: int, cred_id: bytes) -> bytes:
    """Immutable header fields + entry identity; excludes M and N (spec §6.3)."""
    return (MAGIC + bytes([VERSION, SUITE, mode, len(rp_id)]) + rp_id + wrap_salt
            + bytes([index, len(cred_id)]) + cred_id)


def overhead(rp_id: bytes, cred_ids: list[bytes], mode: int) -> int:
    h = 10 + len(rp_id) + 32
    return h + sum(1 + len(c) + 12 + wrapped_len(mode) for c in cred_ids) + 12 + 16


def max_payload_bytes(rp_id: bytes, cred_ids: list[bytes], mode: int) -> int:
    avail = MAX_BLOB - overhead(rp_id, cred_ids, mode)
    return max(0, (avail // 64) * 64 - 2)


def pad(secret: bytes) -> bytes:
    total = 64 * -(-(2 + len(secret)) // 64)
    return struct.pack(">H", len(secret)) + secret + b"\x00" * (total - 2 - len(secret))


def unpad(padded: bytes) -> bytes:
    n = struct.unpack(">H", padded[:2])[0]
    if n > len(padded) - 2 or any(padded[2 + n :]):
        raise VaultError("MALFORMED")
    return padded[2 : 2 + n]


def create_vault(rp_id: bytes, creds: list[dict], secret: bytes, mode: int, m: int,
                 rng: bytes, shamir_rng: bytes | None) -> dict:
    """Mirrors createVault; `rng` is consumed in the spec §11 order."""
    n = len(creds)
    if n < MIN_KEYS:
        raise VaultError("TOO_FEW_KEYS")
    if n > MAX_KEYS:
        raise VaultError("TOO_MANY_KEYS")
    if not (1 <= len(rp_id) <= 64) or any(b < 0x21 or b > 0x7E for b in rp_id):
        raise VaultError("INVALID_ARGUMENT")
    ids = [c["id"] for c in creds]
    if any(not (1 <= len(i) <= 128) for i in ids) or len(set(ids)) != n:
        raise VaultError("INVALID_ARGUMENT")
    if any(len(c["prf"]) != 32 for c in creds):
        raise VaultError("INVALID_ARGUMENT")
    if mode == MODE_ANY and m != 1 or mode == MODE_SHAMIR and not (2 <= m <= n):
        raise VaultError("INVALID_ARGUMENT")
    if len(secret) == 0:
        raise VaultError("INVALID_ARGUMENT")
    mx = max_payload_bytes(rp_id, ids, mode)
    if len(secret) > mx:
        raise VaultError("VAULT_TOO_LARGE")

    pos = 0

    def take(k: int) -> bytes:
        nonlocal pos
        out = rng[pos : pos + k]
        assert len(out) == k, "rng exhausted"
        pos += k
        return out

    wrap_salt = take(32)
    data_key = take(32)
    if mode == MODE_SHAMIR:
        shares = shamir_split(data_key, n, m, shamir_rng or b"")
        plaintexts = [bytes([x]) + y for x, y in shares]
    else:
        shares = None
        plaintexts = [data_key] * n
    header = fixed_header(mode, m, n, rp_id, wrap_salt)
    body = header
    cred_out = []
    for idx, (c, pt) in enumerate(zip(creds, plaintexts)):
        nonce = take(12)
        wk = derive_wrap_key(c["prf"], wrap_salt)
        aad = wrap_aad(mode, rp_id, wrap_salt, idx, c["id"])
        wrapped = gcm_enc(wk, nonce, aad, pt)
        body += bytes([len(c["id"])]) + c["id"] + nonce + wrapped
        cred_out.append({
            "id": c["id"].hex(),
            "prf": c["prf"].hex(),
            "prfInput": LOCATOR_SALT.hex(),
            "ctapSalt": CTAP_SALT.hex(),
            "locator": derive_locator(c["prf"]).hex(),
            "wrapKey": wk.hex(),
            "wrapNonce": nonce.hex(),
            "wrapAad": aad.hex(),
            "wrapPlaintext": pt.hex(),
            "wrapped": wrapped.hex(),
        })
    payload_nonce = take(12)
    assert pos == len(rng), "rng not fully consumed"
    padded = pad(secret)
    ct = gcm_enc(data_key, payload_nonce, body, padded)
    blob = body + payload_nonce + ct
    assert len(blob) <= MAX_BLOB
    return {
        "wrapSalt": wrap_salt,
        "dataKey": data_key,
        "payloadNonce": payload_nonce,
        "credentials": cred_out,
        "shares": shares,
        "padded": padded,
        "payloadAad": body,
        "blob": blob,
        "maxPayloadBytes": mx,
    }


# ----------------------------------------------------------------- decoding
def decode(blob: bytes) -> dict:
    pos = 0

    def take(k: int) -> bytes:
        nonlocal pos
        if pos + k > len(blob):
            raise VaultError("MALFORMED")
        out = blob[pos : pos + k]
        pos += k
        return out

    if len(blob) < 4:
        raise VaultError("MALFORMED")
    if take(4) != MAGIC:
        raise VaultError("BAD_MAGIC")
    if take(1)[0] != VERSION:
        raise VaultError("UNSUPPORTED_VERSION")
    if take(1)[0] != SUITE:
        raise VaultError("UNSUPPORTED_SUITE")
    mode = take(1)[0]
    if mode not in (MODE_ANY, MODE_SHAMIR):
        raise VaultError("UNSUPPORTED_MODE")
    if len(blob) > MAX_BLOB:
        raise VaultError("MALFORMED")
    m, n = take(1)[0], take(1)[0]
    if not (MIN_KEYS <= n <= MAX_KEYS):
        raise VaultError("MALFORMED")
    if mode == MODE_ANY and m != 1 or mode == MODE_SHAMIR and not (2 <= m <= n):
        raise VaultError("MALFORMED")
    rp_len = take(1)[0]
    if not (1 <= rp_len <= 64):
        raise VaultError("MALFORMED")
    rp_id = take(rp_len)
    if any(b < 0x21 or b > 0x7E for b in rp_id):
        raise VaultError("MALFORMED")
    wrap_salt = take(32)
    h = pos
    entries = []
    seen = set()
    for _ in range(n):
        cl = take(1)[0]
        if not (1 <= cl <= 128):
            raise VaultError("MALFORMED")
        cid = take(cl)
        if cid in seen:
            raise VaultError("MALFORMED")
        seen.add(cid)
        entries.append({"credId": cid, "nonce": take(12), "wrapped": take(wrapped_len(mode))})
    p = pos
    rem = len(blob) - p
    if rem < 12 + 80 or (rem - 28) % 64 != 0:
        raise VaultError("MALFORMED")
    return {
        "mode": mode, "threshold": m, "rpId": rp_id, "wrapSalt": wrap_salt,
        "n": n, "entries": entries, "header": blob[:h], "payloadAad": blob[:p],
        "payloadNonce": blob[p : p + 12], "payloadCt": blob[p + 12 :],
    }


def open_vault(blob: bytes, keys: list[dict]) -> bytes:
    return open_full(blob, keys)[0]


def open_full(blob: bytes, keys: list[dict]) -> tuple[bytes, bytes, dict]:
    """Returns (secret, dataKey, decoded)."""
    v = decode(blob)
    unwrapped: dict[int, bytes] = {}
    for k in keys:
        wk = derive_wrap_key(k["prf"], v["wrapSalt"])
        for idx, e in enumerate(v["entries"]):
            if k.get("credId") is not None and e["credId"] != k["credId"]:
                continue
            if idx in unwrapped:
                continue
            aad = wrap_aad(v["mode"], v["rpId"], v["wrapSalt"], idx, e["credId"])
            pt = gcm_dec(wk, e["nonce"], aad, e["wrapped"])
            if pt is not None:
                unwrapped[idx] = pt
                if v["mode"] == MODE_ANY:
                    break
        if v["mode"] == MODE_ANY and unwrapped:
            break
    if not unwrapped:
        raise VaultError("NO_MATCHING_KEY")
    if v["mode"] == MODE_ANY:
        data_key = next(iter(unwrapped.values()))
    else:
        if len(unwrapped) < v["threshold"]:
            raise VaultError("INSUFFICIENT_SHARES")
        chosen = [unwrapped[i] for i in sorted(unwrapped)[: v["threshold"]]]
        data_key = shamir_combine([(s[0], s[1:]) for s in chosen])
    padded = gcm_dec(data_key, v["payloadNonce"], v["payloadAad"], v["payloadCt"])
    if padded is None:
        raise VaultError("AUTH_FAILED")
    return unpad(padded), data_key, v


def entry_bytes(e: dict) -> bytes:
    return bytes([len(e["credId"])]) + e["credId"] + e["nonce"] + e["wrapped"]


def add_key(blob: bytes, key: dict, new: dict, rng: bytes) -> bytes:
    """Spec §6.6; `rng` = newWrapNonce(12) || payloadNonce(12)."""
    v = decode(blob)
    if v["mode"] != MODE_ANY:
        raise VaultError("INVALID_ARGUMENT")
    n = v["n"] + 1
    if n > MAX_KEYS:
        raise VaultError("TOO_MANY_KEYS")
    ids = [e["credId"] for e in v["entries"]]
    if not (1 <= len(new["id"]) <= 128) or new["id"] in ids or len(new["prf"]) != 32:
        raise VaultError("INVALID_ARGUMENT")
    secret, data_key, v = open_full(blob, [key])
    if len(secret) > max_payload_bytes(v["rpId"], ids + [new["id"]], v["mode"]):
        raise VaultError("VAULT_TOO_LARGE")
    assert len(rng) == 24
    header = fixed_header(v["mode"], v["threshold"], n, v["rpId"], v["wrapSalt"])
    wk = derive_wrap_key(new["prf"], v["wrapSalt"])
    wrapped = gcm_enc(wk, rng[:12], wrap_aad(v["mode"], v["rpId"], v["wrapSalt"], n - 1, new["id"]), data_key)
    body = header + b"".join(entry_bytes(e) for e in v["entries"])
    body += bytes([len(new["id"])]) + new["id"] + rng[:12] + wrapped
    return body + rng[12:] + gcm_enc(data_key, rng[12:], body, pad(secret))


def update_payload(blob: bytes, keys: list[dict], new_secret: bytes, rng: bytes) -> bytes:
    """Spec §6.7; `rng` = payloadNonce(12)."""
    _, data_key, v = open_full(blob, keys)
    if len(new_secret) == 0:
        raise VaultError("INVALID_ARGUMENT")
    if len(new_secret) > max_payload_bytes(v["rpId"], [e["credId"] for e in v["entries"]], v["mode"]):
        raise VaultError("VAULT_TOO_LARGE")
    assert len(rng) == 12
    body = v["payloadAad"]
    return body + rng + gcm_enc(data_key, rng, body, pad(new_secret))


def select_vault(candidates: list[bytes], prf: bytes) -> tuple[int, bytes]:
    for i, c in enumerate(candidates):
        try:
            return i, open_vault(c, [{"prf": prf}])
        except VaultError:
            continue
    raise VaultError("NO_MATCHING_VAULT")


def outcome(fn) -> dict:
    try:
        return {"ok": fn()}
    except VaultError as e:
        return {"error": e.code}


# ------------------------------------------------------------------ fixtures
RP_ID = b"cryoshield.app"
CREDS = {
    "A": {"id": det("cred/A/id", 64), "prf": det("cred/A/prf", 32)},
    "B": {"id": det("cred/B/id", 64), "prf": det("cred/B/prf", 32)},
    "C": {"id": det("cred/C/id", 48), "prf": det("cred/C/prf", 32)},
}
UNENROLLED_D = {"id": det("cred/D/id", 64), "prf": det("cred/D/prf", 32)}

SEED_24 = " ".join(["abandon"] * 23 + ["art"]).encode()


def flip(b: bytes, i: int, mask: int = 0x01) -> bytes:
    out = bytearray(b)
    out[i] ^= mask
    return bytes(out)


def set_byte(b: bytes, i: int, v: int) -> bytes:
    out = bytearray(b)
    out[i] = v
    return bytes(out)


def key_json(c: dict, with_cred_id: bool) -> dict:
    return {
        "prf": c["prf"].hex(),
        "credId": c["id"].hex() if with_cred_id else None,
        "prfInput": LOCATOR_SALT.hex(),
        "ctapSalt": CTAP_SALT.hex(),
    }


def build() -> dict:
    vaults_spec = [
        ("any-of-2", "Mode 0x01, keys A+B, 24-word seed phrase.", MODE_ANY, 1, ["A", "B"], SEED_24),
        ("any-of-3", "Mode 0x01, keys A+B+C (C has a 48-byte credential ID).", MODE_ANY, 1,
         ["A", "B", "C"], b"TOTP recovery codes: 1111-2222 3333-4444 5555-6666"),
        ("any-of-2-max", "Mode 0x01, keys A+B, secret of exactly maxPayloadBytes (638); padding granularity makes the blob 974 bytes.",
         MODE_ANY, 1, ["A", "B"], det("vault/any-of-2-max/secret", 638)),
        ("shamir-2-of-3", "Mode 0x02 (experimental), 2-of-3 over keys A+B+C.", MODE_SHAMIR, 2,
         ["A", "B", "C"], b"correct horse battery staple"),
    ]
    vaults = []
    blobs: dict[str, bytes] = {}
    meta: dict[str, dict] = {}
    for name, desc, mode, m, keys, secret in vaults_spec:
        creds = [CREDS[k] for k in keys]
        n = len(creds)
        rng = det(f"vault/{name}/wrapSalt", 32) + det(f"vault/{name}/dataKey", 32)
        rng += b"".join(det(f"vault/{name}/wrapNonce/{i}", 12) for i in range(n))
        rng += det(f"vault/{name}/payloadNonce", 12)
        shamir_rng = None
        if mode == MODE_SHAMIR:
            shamir_rng = det(f"vault/{name}/shamir/coords", 255) + nonzero(
                det(f"vault/{name}/shamir/coefficients", 32 * (m - 1)))
        r = create_vault(RP_ID, creds, secret, mode, m, rng, shamir_rng)
        blobs[name] = r["blob"]
        meta[name] = r
        # self-check: every single key (mode 1) / every M-subset (mode 2) opens
        if mode == MODE_ANY:
            for c in creds:
                assert open_vault(r["blob"], [{"prf": c["prf"]}]) == secret
        try:
            text = secret.decode("utf-8")
        except UnicodeDecodeError:
            text = None
        vaults.append({
            "name": name,
            "description": desc,
            "mode": mode,
            "threshold": m,
            "rpId": RP_ID.decode(),
            "keys": keys,
            "secret": secret.hex(),
            "secretUtf8": text,
            "wrapSalt": r["wrapSalt"].hex(),
            "dataKey": r["dataKey"].hex(),
            "payloadNonce": r["payloadNonce"].hex(),
            "rng": rng.hex(),
            "shamirRng": shamir_rng.hex() if shamir_rng else None,
            "shamir": None if r["shares"] is None else {
                "field": "GF(2^8) mod 0x11B",
                "shares": [{"x": x, "y": y.hex(), "wrapPlaintext": (bytes([x]) + y).hex()}
                           for x, y in r["shares"]],
            },
            "credentials": r["credentials"],
            "paddedPlaintext": r["padded"].hex(),
            "payloadAad": r["payloadAad"].hex(),
            "maxPayloadBytes": r["maxPayloadBytes"],
            "blob": r["blob"].hex(),
            "blobLength": len(r["blob"]),
        })

    v1 = blobs["any-of-2"]
    v1_dec = decode(v1)
    h = len(v1_dec["header"])
    entry_a_wrapped_off = h + 1 + 64 + 12  # first byte of entry A's wrapped key
    p = len(v1_dec["payloadAad"])
    A, B, C = CREDS["A"], CREDS["B"], CREDS["C"]

    # ---------------------------------------------------------- decode cases
    decode_cases = []

    def add_decode(name: str, desc: str, blob: bytes) -> None:
        o = outcome(lambda: decode(blob))
        case = {"name": name, "description": desc, "blob": blob.hex()}
        if "error" in o:
            case["expectedError"] = o["error"]
        else:
            d = o["ok"]
            case["expected"] = {
                "mode": d["mode"], "threshold": d["threshold"], "rpId": d["rpId"].decode(),
                "wrapSalt": d["wrapSalt"].hex(),
                "credIds": [e["credId"].hex() for e in d["entries"]],
                "headerLength": len(d["header"]), "payloadOffset": len(d["payloadAad"]),
            }
        decode_cases.append(case)

    for vn in ("any-of-2", "any-of-3", "shamir-2-of-3"):
        add_decode(f"valid-{vn}", f"The {vn} vault blob decodes.", blobs[vn])
    add_decode("bad-magic", "Magic 'CRYP' instead of 'CRYO'.", set_byte(v1, 3, ord("P")))
    add_decode("unknown-version", "Version byte 0x02.", set_byte(v1, 4, 0x02))
    add_decode("unknown-suite", "Suite byte 0x02.", set_byte(v1, 5, 0x02))
    add_decode("unknown-mode", "Mode byte 0x03.", set_byte(v1, 6, 0x03))
    add_decode("bad-threshold", "Mode 0x01 with threshold 2.", set_byte(v1, 7, 0x02))
    add_decode("single-key-count", "Key count N = 1.", set_byte(v1, 8, 0x01))
    add_decode("truncated-last-byte", "Blob with the final byte removed.", v1[:-1])
    add_decode("truncated-header", "Blob cut to its first 20 bytes.", v1[:20])
    add_decode("truncated-magic", "Blob of 3 bytes.", v1[:3])
    add_decode("oversize-blob", "The max vault with one extra 64-byte payload block (1038 bytes > 1024).",
               blobs["any-of-2-max"] + b"\x00" * 64)
    add_decode("zero-rpid-length", "rpIdLen = 0.", set_byte(v1, 9, 0x00))
    dup = bytearray(v1)
    entry_b_off = h + 1 + 64 + 12 + 48
    dup[entry_b_off + 1 : entry_b_off + 65] = A["id"]
    add_decode("duplicate-cred-id", "Entry B's credential ID replaced by entry A's.", bytes(dup))

    # ------------------------------------------------------------ open cases
    open_cases = []

    def add_open(name: str, desc: str, vault: str | None, blob: bytes, keys: list[tuple[dict, bool]]) -> None:
        ks = [{"prf": c["prf"], "credId": c["id"] if w else None} for c, w in keys]
        o = outcome(lambda: open_vault(blob, ks))
        case = {"name": name, "description": desc, "vault": vault, "blob": blob.hex(),
                "keys": [key_json(c, w) for c, w in keys]}
        if "error" in o:
            case["expectedError"] = o["error"]
        else:
            case["expectedSecret"] = o["ok"].hex()
        open_cases.append(case)

    add_open("any-of-2-key-A", "Key A alone (credId given) opens.", "any-of-2", v1, [(A, True)])
    add_open("any-of-2-key-B", "Key B alone (no credId) opens.", "any-of-2", v1, [(B, False)])
    add_open("any-of-3-key-C", "Key C alone opens.", "any-of-3", blobs["any-of-3"], [(C, True)])
    add_open("any-of-2-max-key-B", "Max-size vault opens with B.", "any-of-2-max",
             blobs["any-of-2-max"], [(B, False)])
    add_open("wrong-key", "Unenrolled key D.", "any-of-2", v1, [(UNENROLLED_D, False)])
    add_open("unknown-cred-id", "Key A's PRF but key D's credential ID.", "any-of-2", v1,
             [({"prf": A["prf"], "id": UNENROLLED_D["id"]}, True)])
    add_open("tampered-header-rpid", "One rpId byte flipped (inside every wrap AAD).", "any-of-2",
             flip(v1, 10), [(A, False)])
    add_open("tampered-header-wrapsalt", "One wrapSalt byte flipped.", "any-of-2",
             flip(v1, h - 1), [(A, False)])
    add_open("tampered-wrapped-key-own", "Entry A's wrapped key flipped, opened with A.", "any-of-2",
             flip(v1, entry_a_wrapped_off), [(A, True)])
    add_open("tampered-wrapped-key-other",
             "Entry A's wrapped key flipped, opened with B (payload AAD covers entry A).",
             "any-of-2", flip(v1, entry_a_wrapped_off), [(B, False)])
    sw = bytearray(v1)
    ea = v1[h : h + 125]
    eb = v1[h + 125 : h + 250]
    sw[h : h + 250] = eb + ea
    add_open("swapped-entries", "Entries A and B swapped (wrap AAD binds the entry index).", "any-of-2",
             bytes(sw), [(A, False)])
    add_open("tampered-payload-nonce", "Payload nonce flipped.", "any-of-2", flip(v1, p), [(A, False)])
    add_open("tampered-payload-ct", "Last tag byte of the payload flipped.", "any-of-2",
             flip(v1, len(v1) - 1), [(A, False)])
    sv = blobs["shamir-2-of-3"]
    add_open("shamir-A-B", "2-of-3 with keys A and B.", "shamir-2-of-3", sv, [(A, False), (B, False)])
    add_open("shamir-B-C", "2-of-3 with keys B and C.", "shamir-2-of-3", sv, [(B, True), (C, True)])
    add_open("shamir-C-A", "2-of-3 with keys C and A (given in reverse order).", "shamir-2-of-3", sv,
             [(C, False), (A, False)])
    add_open("shamir-A-B-C", "2-of-3 with all three keys.", "shamir-2-of-3", sv,
             [(A, False), (B, False), (C, False)])
    add_open("shamir-insufficient", "2-of-3 with only key A.", "shamir-2-of-3", sv, [(A, False)])
    add_open("shamir-insufficient-dup", "2-of-3 with key A supplied twice.", "shamir-2-of-3", sv,
             [(A, False), (A, False)])
    add_open("shamir-wrong-key", "2-of-3 with unenrolled key D.", "shamir-2-of-3", sv,
             [(UNENROLLED_D, False)])

    # ---------------------------------------------------------- create cases
    create_cases = []

    def add_create(name: str, desc: str, keys: list[dict], secret: bytes, mode: int = MODE_ANY,
                   m: int = 1, rp_id: bytes = RP_ID) -> None:
        o = outcome(lambda: create_vault(rp_id, keys, secret, mode, m, b"", None))
        assert "error" in o, name
        ids = [k["id"] for k in keys]
        case = {
            "name": name, "description": desc, "rpId": rp_id.decode(), "mode": mode, "threshold": m,
            "credentials": [{"id": k["id"].hex(), "prf": k["prf"].hex()} for k in keys],
            "secret": secret.hex(), "expectedError": o["error"],
        }
        if o["error"] == "VAULT_TOO_LARGE":
            case["maxPayloadBytes"] = max_payload_bytes(rp_id, ids, mode)
        create_cases.append(case)

    add_create("oversize-payload", "639-byte secret with 2 keys (max is 638).", [A, B],
               det("create/oversize", 639))
    add_create("oversize-payload-3-keys", "575-byte secret with keys A+B+C (max is 574).", [A, B, C],
               det("create/oversize3", 575))
    add_create("single-key", "Mode 0x01 with one key.", [A], b"secret")
    nine = [{"id": det(f"create/nine/{i}/id", 16), "prf": det(f"create/nine/{i}/prf", 32)} for i in range(9)]
    add_create("nine-keys", "Mode 0x01 with nine keys.", nine, b"secret")
    add_create("empty-secret", "Empty secret.", [A, B], b"")
    add_create("cred-id-too-long", "129-byte credential ID.", [A, {"id": det("create/long", 129), "prf": B["prf"]}],
               b"secret")
    add_create("duplicate-cred-id", "Same credential twice.", [A, A], b"secret")
    add_create("shamir-threshold-too-high", "Mode 0x02 with M = 4 > N = 3.", [A, B, C], b"secret",
               MODE_SHAMIR, 4)

    # ------------------------------------------------------- add-key cases
    add_key_cases = []

    def add_add(name: str, desc: str, vault: str, blob: bytes, key: tuple[dict, bool], new: dict,
                rng: bytes) -> None:
        k = {"prf": key[0]["prf"], "credId": key[0]["id"] if key[1] else None}
        o = outcome(lambda: add_key(blob, k, new, rng))
        case = {"name": name, "description": desc, "vault": vault, "blob": blob.hex(),
                "key": key_json(*key), "newCredential": {"id": new["id"].hex(), "prf": new["prf"].hex(),
                                                         "locator": derive_locator(new["prf"]).hex()},
                "rng": rng.hex()}
        if "error" in o:
            case["expectedError"] = o["error"]
        else:
            out = o["ok"]
            case["expectedBlob"] = out.hex()
            case["expectedBlobLength"] = len(out)
            # self-checks: every key opens; existing entries byte-identical
            secret = open_vault(blob, [k])
            for c in [CREDS[x] for x in ("A", "B")] + [new]:
                assert open_vault(out, [{"prf": c["prf"]}]) == secret
            d_in = decode(blob)
            hh, pp = len(d_in["header"]), len(d_in["payloadAad"])
            assert out[hh:pp] == blob[hh:pp], "existing entries must be byte-identical"
            assert out[:hh] == blob[:8] + bytes([d_in["n"] + 1]) + blob[9:hh]
        add_key_cases.append(case)

    add_rng = det("addkey/wrapNonce", 12) + det("addkey/payloadNonce", 12)
    add_add("add-C-with-A", "Add key C to any-of-2 using only key A.", "any-of-2", v1, (A, True), C, add_rng)
    add_add("add-C-with-wrong-key", "Add key C using unenrolled key D.", "any-of-2", v1, (UNENROLLED_D, False),
            C, add_rng)
    add_add("add-duplicate", "Add key B again using key A.", "any-of-2", v1, (A, False), B, add_rng)
    add_add("add-to-shamir", "Add key D to the 2-of-3 Shamir vault.", "shamir-2-of-3", blobs["shamir-2-of-3"],
            (A, False), UNENROLLED_D, add_rng)
    add_add("add-oversize", "Add key C to the 1024-byte max vault.", "any-of-2-max", blobs["any-of-2-max"],
            (A, False), C, add_rng)
    # 9th key: build an 8-key vault (short credIds) and try to add one more
    eight = [{"id": det(f"eight/{i}/id", 16), "prf": det(f"eight/{i}/prf", 32)} for i in range(8)]
    eight_rng = det("vault/eight/rng", 32 + 32 + 12 * 8 + 12)
    eight_blob = create_vault(RP_ID, eight, b"eight keys", MODE_ANY, 1, eight_rng, None)["blob"]
    add_add("add-ninth-key", "Add a 9th key to an 8-key vault.", "inline", eight_blob, (eight[0], False),
            C, add_rng)

    # -------------------------------------------------- update-payload cases
    update_cases = []

    def add_update(name: str, desc: str, vault: str, blob: bytes, keys: list[tuple[dict, bool]],
                   new_secret: bytes, rng: bytes) -> None:
        ks = [{"prf": c["prf"], "credId": c["id"] if w else None} for c, w in keys]
        o = outcome(lambda: update_payload(blob, ks, new_secret, rng))
        case = {"name": name, "description": desc, "vault": vault, "blob": blob.hex(),
                "keys": [key_json(c, w) for c, w in keys], "newSecret": new_secret.hex(), "rng": rng.hex()}
        if "error" in o:
            case["expectedError"] = o["error"]
            if o["error"] == "VAULT_TOO_LARGE":
                d = decode(blob)
                case["maxPayloadBytes"] = max_payload_bytes(d["rpId"], [e["credId"] for e in d["entries"]], d["mode"])
        else:
            case["expectedBlob"] = o["ok"].hex()
            assert open_vault(o["ok"], ks) == new_secret
            if decode(blob)["mode"] == MODE_ANY:
                for c in (A, B):
                    assert open_vault(o["ok"], [{"prf": c["prf"]}]) == new_secret
        update_cases.append(case)

    up_rng = det("update/payloadNonce", 12)
    add_update("update-with-B", "Key B replaces the any-of-2 secret.", "any-of-2", v1, [(B, False)],
               b"new seed phrase goes here", up_rng)
    add_update("update-wrong-key", "Unenrolled key D tries to update.", "any-of-2", v1, [(UNENROLLED_D, False)],
               b"x", up_rng)
    add_update("update-oversize", "639-byte secret into any-of-2 (max 638).", "any-of-2", v1, [(A, False)],
               det("update/oversize", 639), up_rng)
    add_update("update-shamir-A-C", "Keys A and C update the 2-of-3 secret.", "shamir-2-of-3",
               blobs["shamir-2-of-3"], [(A, False), (C, False)], b"rotated shamir secret", up_rng)

    # ---------------------------------------------------------- select cases
    junk_garbage = det("select/garbage", 200)
    forged = (fixed_header(MODE_ANY, 1, 2, RP_ID, det("select/forged/salt", 32))
              + bytes([64]) + A["id"] + det("select/forged/a", 12 + 48)
              + bytes([64]) + B["id"] + det("select/forged/b", 12 + 48)
              + det("select/forged/payload", 12 + 64 + 16))
    replay = v1[:p] + det("select/replay/payload", len(v1) - p)
    assert outcome(lambda: decode(forged)).get("ok") is not None
    assert outcome(lambda: decode(replay)).get("ok") is not None
    select_cases = []

    def add_select(name: str, desc: str, cands: list[tuple[str, bytes]], c: dict) -> None:
        o = outcome(lambda: select_vault([b for _, b in cands], c["prf"]))
        case = {"name": name, "description": desc, **key_json(c, False),
                "candidateKinds": [k for k, _ in cands], "candidates": [b.hex() for _, b in cands]}
        if "error" in o:
            case["expectedError"] = o["error"]
        else:
            case["expectedIndex"], sec = o["ok"]
            case["expectedSecret"] = sec.hex()
        select_cases.append(case)

    squat = [("garbage", junk_garbage), ("forged-entries", forged), ("replayed-header", replay)]
    add_select("squatted-locator",
               "Genuine any-of-2 blob after three junk blobs, followed by the genuine any-of-3 blob.",
               squat + [("genuine", v1), ("genuine-other", blobs["any-of-3"])], A)
    add_select("no-genuine-candidate", "Only junk blobs under the locator.", squat, A)
    add_select("empty-candidate-list", "Locator resolves to no vaultIds.", [], A)

    # ------------------------------------------- authenticator-data cases
    rp_hash = hashlib.sha256(RP_ID).digest()
    sign_count = struct.pack(">I", 7)
    auth_cases = []
    for name, desc, data in [
        ("uv-set", "Flags UP|UV (0x05): PRF output may be used.", rp_hash + b"\x05" + sign_count),
        ("uv-set-with-attested-data", "Flags UP|UV|AT (0x45), as from create().", rp_hash + b"\x45" + sign_count),
        ("up-only", "Flags UP (0x01): no user verification.", rp_hash + b"\x01" + sign_count),
        ("all-but-uv", "Every flag except UV (0xfb).", rp_hash + b"\xfb" + sign_count),
        ("truncated", "36 bytes: too short to hold flags and signCount.", (rp_hash + b"\x05" + sign_count)[:36]),
    ]:
        o = outcome(lambda: assert_user_verified(data))
        auth_cases.append({"name": name, "description": desc, "authenticatorData": data.hex(),
                           "expectedError": o.get("error")})

    return {
        "name": "cryoshield-vault-v1",
        "formatVersion": 1,
        "spec": "docs/spec/vault-format-v1.md",
        "generatedBy": "packages/vault-crypto/scripts/gen-vectors.py",
        "encoding": "All byte strings are lowercase hex. Integers are JSON numbers.",
        "constants": {
            "magic": MAGIC.hex(), "version": VERSION, "suite": SUITE,
            "modeAnyOfN": MODE_ANY, "modeShamir": MODE_SHAMIR,
            "maxBlobBytes": MAX_BLOB, "minKeys": MIN_KEYS, "maxKeys": MAX_KEYS,
            "locatorSaltInput": LOCATOR_SALT_INPUT.decode(),
            "locatorSalt": LOCATOR_SALT.hex(),
            "ctapSalt": CTAP_SALT.hex(),
            "infoLocator": INFO_LOCATOR.decode(), "infoWrap": INFO_WRAP.decode(),
            "userVerification": USER_VERIFICATION,
            "uvFlagMask": UV_FLAG,
            "shamirField": "GF(2^8) mod 0x11B",
        },
        "derivations": [
            {
                "name": f"key-{k}",
                "prf": c["prf"].hex(),
                "prfInput": LOCATOR_SALT.hex(),
                "ctapSalt": CTAP_SALT.hex(),
                "locator": derive_locator(c["prf"]).hex(),
                "wrapSalt": meta["any-of-2"]["wrapSalt"].hex(),
                "wrapKey": derive_wrap_key(c["prf"], meta["any-of-2"]["wrapSalt"]).hex(),
            }
            for k, c in [("A", A), ("B", B), ("C", C), ("D", UNENROLLED_D)]
        ],
        "vaults": vaults,
        "decodeCases": decode_cases,
        "openCases": open_cases,
        "createCases": create_cases,
        "addKeyCases": add_key_cases,
        "updatePayloadCases": update_cases,
        "selectCases": select_cases,
        "authenticatorDataCases": auth_cases,
    }


def render() -> str:
    return json.dumps(build(), indent=2, ensure_ascii=True) + "\n"


def main() -> int:
    text = render()
    if "--check" in sys.argv[1:]:
        current = OUT.read_text() if OUT.exists() else ""
        if current != text:
            print(f"MISMATCH: {OUT} differs from a fresh generation", file=sys.stderr)
            return 1
        print(f"OK: {OUT} is byte-identical to a fresh generation")
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text)
    print(f"wrote {OUT} ({len(text)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

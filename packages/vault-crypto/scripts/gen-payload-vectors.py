#!/usr/bin/env python3
"""Generate docs/spec/payload-vectors.json (vault payload encoding v1 + v2).

Normative spec: docs/spec/payload-v2.md (OpenSpec change vault-list-labels-archive,
design D1-D4, D11). This script holds an independent Python reference codec for
the payload layer (strict canonical decoding, the minimal-version writer and the
"Archive and clear" sizing rule) and checks every vector against it before
writing. Blob vectors encrypt v2 payloads with the vault format v1 reference
implementation in gen-vectors.py (same test credentials A and B as
packages/vault-crypto/test-vectors/v1.json, deterministic randomness).

No clock, no randomness: a run regenerates byte-identical JSON. Dependencies are
the pinned scripts/requirements.txt (via gen-vectors.py).

Usage:
    python gen-payload-vectors.py           # (re)write docs/spec/payload-vectors.json
    python gen-payload-vectors.py --check   # exit 1 if the file differs from a fresh run
    python gen-payload-vectors.py --stdout  # print a fresh generation
"""

from __future__ import annotations

import importlib.util
import json
import re
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent.parent
OUT = REPO / "docs" / "spec" / "payload-vectors.json"

_spec = importlib.util.spec_from_file_location("gen_vectors", HERE / "gen-vectors.py")
assert _spec is not None and _spec.loader is not None
gv = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gv)

MALFORMED = "MALFORMED"
UNKNOWN_VERSION = "UNKNOWN_VERSION"
MAX_LABEL_CPS = 64
MAX_NAME_CPS = 40
# C0, DEL, C1, U+2028/U+2029, bidi embeddings/overrides U+202A-202E, isolates U+2066-2069 (spec 4.3).
FORBIDDEN_NAME_CPS = frozenset(
    list(range(0x00, 0x20)) + [0x7F] + list(range(0x80, 0xA0)) + [0x2028, 0x2029]
    + list(range(0x202A, 0x202F)) + list(range(0x2066, 0x206A))
)
VERSION_PREFIX = re.compile(r'\{"v":(0|[1-9][0-9]*)[,}]')


class PayloadError(Exception):
    def __init__(self, code: str, reencoded: bytes | None = None):
        super().__init__(code)
        self.code = code
        self.reencoded = reencoded


# ------------------------------------------------------------ reference codec
def _well_formed(s: str) -> bool:
    return not any(0xD800 <= ord(c) <= 0xDFFF for c in s)


def valid_name(n: Any) -> bool:
    return (type(n) is str and _well_formed(n) and 1 <= len(n) <= MAX_NAME_CPS
            and not any(ord(c) in FORBIDDEN_NAME_CPS for c in n))


def valid_item(x: Any) -> bool:
    if type(x) is not dict or list(x.keys()) != ["l", "s"]:
        return False
    lab, val = x["l"], x["s"]
    return (type(lab) is str and type(val) is str and _well_formed(lab) and _well_formed(val)
            and len(lab) <= MAX_LABEL_CPS)


def validate(p: dict) -> None:
    """p = {version, name, archived, items, pad} (the VaultPayload of design D1)."""
    if p["version"] not in (1, 2) or type(p["version"]) is not int:
        raise PayloadError(MALFORMED)
    if type(p["items"]) is not list or not all(valid_item(i) for i in p["items"]):
        raise PayloadError(MALFORMED)
    if type(p["archived"]) is not bool:
        raise PayloadError(MALFORMED)
    if p["version"] == 1:
        if p["name"] is not None or p["archived"] or p["pad"] is not None or not p["items"]:
            raise PayloadError(MALFORMED)
        return
    if p["name"] is not None and not valid_name(p["name"]):
        raise PayloadError(MALFORMED)
    if p["pad"] is not None:
        z = p["pad"]
        if type(z) is not str or not z or z.strip("0") or p["items"]:
            raise PayloadError(MALFORMED)


def encode(p: dict) -> bytes:
    """Canonical encoding of a validated payload (spec section 5)."""
    validate(p)
    wire: dict[str, Any] = {"v": p["version"]}
    if p["name"] is not None:
        wire["n"] = p["name"]
    if p["archived"]:
        wire["a"] = True
    wire["items"] = [{"l": i["l"], "s": i["s"]} for i in p["items"]]
    if p["pad"] is not None:
        wire["z"] = p["pad"]
    return json.dumps(wire, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def write(name: str | None, archived: bool, items: list[dict], pad: str | None) -> bytes:
    """The writer: minimal version (design D2, spec section 6)."""
    v1 = name is None and not archived and pad is None and len(items) > 0
    return encode({"version": 1 if v1 else 2, "name": name, "archived": archived, "items": items, "pad": pad})


def _no_duplicates(pairs: list[tuple[str, Any]]) -> dict:
    keys = [k for k, _ in pairs]
    if len(set(keys)) != len(keys):
        raise PayloadError(MALFORMED)
    return dict(pairs)


def _reject_constant(_: str) -> Any:
    raise PayloadError(MALFORMED)


def decode(data: bytes) -> dict:
    """Strict canonical decoding (design D3, spec section 7)."""
    try:
        text = data.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        raise PayloadError(MALFORMED) from None
    m = VERSION_PREFIX.match(text)
    if m and int(m.group(1)) >= 3:
        raise PayloadError(UNKNOWN_VERSION)
    try:
        obj = json.loads(text, object_pairs_hook=_no_duplicates, parse_constant=_reject_constant)
    except PayloadError:
        raise
    except Exception:  # JSONDecodeError, RecursionError, ...
        raise PayloadError(MALFORMED) from None
    if type(obj) is not dict:
        raise PayloadError(MALFORMED)
    v = obj.get("v")
    if type(v) is not int or v not in (1, 2):  # type() excludes bool: True == 1
        raise PayloadError(MALFORMED)
    allowed = ("v", "items") if v == 1 else ("v", "n", "a", "items", "z")
    if any(k not in allowed for k in obj) or "items" not in obj:
        raise PayloadError(MALFORMED)
    if "a" in obj and not (type(obj["a"]) is bool and obj["a"] is True):
        raise PayloadError(MALFORMED)
    p = {"version": v, "name": obj.get("n"), "archived": "a" in obj, "items": obj["items"], "pad": obj.get("z")}
    if "n" in obj and obj["n"] is None or "z" in obj and obj["z"] is None:
        raise PayloadError(MALFORMED)
    try:
        again = encode(p)
    except UnicodeEncodeError:
        raise PayloadError(MALFORMED) from None
    if again != data:
        raise PayloadError(MALFORMED, reencoded=again)
    return p


def clear(previous: bytes, max_payload_bytes: int) -> bytes:
    """Archive and clear (design D4, spec section 8)."""
    prev = decode(previous)
    c0 = len(write(prev["name"], True, [], None))
    p_len = len(previous)
    k = p_len - c0 - 7  # len(',"z":""') == 7
    if k >= 1:
        pad: str | None = "0" * k
    elif c0 >= p_len:
        pad = None
    elif c0 + 8 <= max_payload_bytes:
        pad = "0"
    else:
        pad = None
    out = write(prev["name"], True, [], pad)
    if len(out) > max_payload_bytes:
        raise PayloadError("VAULT_TOO_LARGE")
    return out


def padded_len(n: int) -> int:
    return 64 * -(-(2 + n) // 64)


# ------------------------------------------------------------------ helpers
def item(label: str, value: str) -> dict:
    return {"l": label, "s": value}


def decoded_json(p: dict) -> dict:
    return {"version": p["version"], "name": p["name"], "archived": p["archived"],
            "items": [{"l": i["l"], "s": i["s"]} for i in p["items"]], "pad": p["pad"]}


def text_of(data: bytes) -> str | None:
    """The exact payload text, or None when the bytes are not well-formed UTF-8."""
    try:
        return data.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        return None


SEED_12 = " ".join(["abandon"] * 11 + ["about"])
V1_DOC_EXAMPLES = {  # apps/web/docs/payload-v1.md, byte for byte
    "v1-single": "7b2276223a312c226974656d73223a5b7b226c223a22426974636f696e2073656564222c2273223a226162616e646f6e206162616e646f6e206162616e646f6e206162616e646f6e206162616e646f6e206162616e646f6e206162616e646f6e206162616e646f6e206162616e646f6e206162616e646f6e206162616e646f6e2061626f7574227d5d7d",
    "v1-multi": "7b2276223a312c226974656d73223a5b7b226c223a22476974487562207265636f7665727920636f646573222c2273223a2231613262332d63346435655c6e36663767382d683969306a227d2c7b226c223a22456d61696c20324641222c2273223a224a425357593344504548504b33505850227d5d7d",
    "v1-unicode": "7b2276223a312c226974656d73223a5b7b226c223a224e6f74697a656e20e29c93222c2273223a2250617373776f72743a206772c3bc6e2dc39c227d5d7d",
}
ITEMS_SINGLE = [item("Bitcoin seed", SEED_12)]
ITEMS_MULTI = [item("GitHub recovery codes", "1a2b3-c4d5e\n6f7g8-h9i0j"), item("Email 2FA", "JBSWY3DPEHPK3PXP")]
ITEMS_UNICODE = [item("Notizen \u2713", "Passwort: gr\u00fcn-\u00dc")]
ITEMS_THREE = ITEMS_MULTI + [item("Bitcoin seed", SEED_12)]
NAME_NON_BMP = "Family \U0001F468\u200d\U0001F469\u200d\U0001F467 \U0001D49C"
ESCAPES_SECRET = ("quote \" backslash \\ slash / newline \n cr \r tab \t bs \b ff \f nul \u0000 "
                  "us \u001f del \u007f nel \u0085 ls \u2028 ps \u2029 rlo \u202e bom \ufeff <script>")


def build() -> dict:
    # ------------------------------------------------------------ positive
    positive: list[dict] = []

    def pos(id_: str, desc: str, data: bytes) -> None:
        p = decode(data)  # raises if the vector is wrong
        assert encode(p) == data
        positive.append({"id": id_, "description": desc, "hex": data.hex(), "text": text_of(data),
                         "decoded": decoded_json(p), "canonicalHex": encode(p).hex()})

    def v2(name: str | None = None, archived: bool = False, items: list[dict] | None = None,
           pad: str | None = None) -> bytes:
        return encode({"version": 2, "name": name, "archived": archived,
                       "items": items if items is not None else [], "pad": pad})

    for id_, items_, desc in [
        ("v1-single", ITEMS_SINGLE, "payload-v1.md example:single."),
        ("v1-multi", ITEMS_MULTI, "payload-v1.md example:multi (a newline escape in a secret)."),
        ("v1-unicode", ITEMS_UNICODE, "payload-v1.md example:unicode (raw UTF-8, no \\u escapes)."),
    ]:
        data = write(None, False, items_, None)
        assert data.hex() == V1_DOC_EXAMPLES[id_], id_
        pos(id_, desc, data)
    pos("v1-empty-label", "v1 allows a 0-code-point label.", write(None, False, [item("", "x")], None))
    pos("v1-label-64-code-points", "v1 label of exactly 64 code points (4-byte characters).",
        write(None, False, [item("\U0001F511" * 64, "x")], None))
    pos("v2-named", "Named, active vault.", v2("Family", items=ITEMS_MULTI))
    pos("v2-archived", "Unnamed, archived vault.", v2(archived=True, items=ITEMS_SINGLE))
    pos("v2-named-archived", "Named and archived.", v2("Old work 2FA", True, ITEMS_MULTI))
    pos("v2-empty-items", "v2 allows an empty items array (unnamed, active, no z).", v2())
    pos("v2-named-empty-items", "Named vault with no items.", v2("Empty", items=[]))
    pos("v2-cleared", "After Archive and clear: name kept, archived, no items, z padding.",
        v2("Family", True, [], "0" * 40))
    pos("v2-cleared-unarchived", "A cleared vault that was unarchived again keeps z.", v2(None, False, [], "0000"))
    pos("v2-z-single", "Shortest z: one ASCII 0.", v2(None, True, [], "0"))
    pos("v2-name-non-bmp", "Name with a ZWJ emoji sequence and a non-BMP letter (raw 4-byte UTF-8).",
        v2(NAME_NON_BMP, items=ITEMS_UNICODE))
    pos("v2-name-40-code-points", "Name of exactly 40 code points, each a 4-byte character (160 bytes).",
        v2("\U0001F600" * 40, items=ITEMS_SINGLE))
    pos("v2-name-40-ascii", "Name of exactly 40 ASCII characters.", v2("N" * 40, items=ITEMS_SINGLE))
    pos("v2-name-combining", "Name with a combining mark: 'Cafe' + U+0301 is 5 code points, not NFC-normalized.",
        v2("Cafe\u0301", items=ITEMS_SINGLE))
    pos("v2-name-quote-backslash", "Name with a quote and a backslash (escaped as \\\" and \\\\).",
        v2('My "main" \\ vault', items=ITEMS_SINGLE))
    pos("v2-name-spaces", "Leading and trailing spaces are kept as-is (no trimming in the codec).",
        v2(" spaced ", items=ITEMS_SINGLE))
    pos("v2-escapes", "Canonical escapes in a secret: \\\" \\\\ \\n \\r \\t \\b \\f, \\u0000 and \\u001f "
        "(lowercase); DEL, C1, U+2028/2029, U+202E, U+FEFF and '/' stay raw.",
        v2("Escapes", items=[item("esc", ESCAPES_SECRET)]))
    pos("v2-label-bidi", "Labels keep the v1 rules: a U+202E in a label is valid (display must make it inert).",
        v2(items=[item("abc\u202edef", "x")]))
    pos("v2-non-minimal", "v2 with no n, a or z and one item: valid to decode; the writer would emit v1 "
        "(see writer case writer-unnamed-active-v1).", v2(items=ITEMS_SINGLE))

    # ------------------------------------------------------------ negative
    negative: list[dict] = []

    def neg(id_: str, desc: str, data: bytes | str, expect: str = MALFORMED) -> None:
        b = data.encode("utf-8", errors="surrogatepass") if isinstance(data, str) else data
        try:
            decode(b)
        except PayloadError as e:
            assert e.code == expect, (id_, e.code)
            negative.append({"id": id_, "description": desc, "hex": b.hex(), "text": text_of(b),
                             "error": e.code, "canonicalHex": e.reencoded.hex() if e.reencoded else None})
            return
        raise AssertionError(f"negative vector {id_} decoded")

    I1 = '[{"l":"a","s":"b"}]'
    neg("dup-member-n", "Duplicate n.", '{"v":2,"n":"a","n":"b","items":[]}')
    neg("dup-member-n-same-value", "Duplicate n with the same value.", '{"v":2,"n":"a","n":"a","items":[]}')
    neg("dup-member-v", "Duplicate v.", '{"v":2,"v":2,"items":[]}')
    neg("dup-member-items", "Duplicate items.", '{"v":1,"items":' + I1 + ',"items":' + I1 + '}')
    neg("dup-member-in-item", "Duplicate l inside an item.", '{"v":1,"items":[{"l":"a","l":"a","s":"b"}]}')
    neg("a-false", '"a":false (absent means active).', '{"v":2,"a":false,"items":[]}')
    neg("a-one", '"a":1 (Python: 1 == True, so check type(a) is bool).', '{"v":2,"a":1,"items":[]}')
    neg("a-string", '"a":"true".', '{"v":2,"a":"true","items":[]}')
    neg("a-null", '"a":null.', '{"v":2,"a":null,"items":[]}')
    neg("n-empty", "Empty name (absent means unnamed).", '{"v":2,"n":"","items":[]}')
    neg("n-null", '"n":null.', '{"v":2,"n":null,"items":[]}')
    neg("n-number", "Non-string name.", '{"v":2,"n":5,"items":[]}')
    neg("n-41-code-points", "Name of 41 code points.", '{"v":2,"n":"' + "N" * 41 + '","items":[]}')
    neg("n-41-code-points-non-bmp", "Name of 41 four-byte code points.",
        '{"v":2,"n":"' + "\U0001F600" * 41 + '","items":[]}')
    neg("n-c0", "Name with a C0 control (\\u0001).", '{"v":2,"n":"a\\u0001b","items":[]}')
    neg("n-newline", "Name with a newline (\\n).", '{"v":2,"n":"a\\nb","items":[]}')
    neg("n-del", "Name with DEL (U+007F) (assumption A1: DEL counts as a control).",
        '{"v":2,"n":"a\u007fb","items":[]}')
    neg("n-c1", "Name with a C1 control (U+0085 NEL).", '{"v":2,"n":"a\u0085b","items":[]}')
    neg("n-2028", "Name with U+2028 LINE SEPARATOR.", '{"v":2,"n":"a\u2028b","items":[]}')
    neg("n-2029", "Name with U+2029 PARAGRAPH SEPARATOR.", '{"v":2,"n":"a\u2029b","items":[]}')
    neg("n-bidi-202a", "Name with U+202A LRE.", '{"v":2,"n":"a\u202ab","items":[]}')
    neg("n-bidi-202e", "Name with U+202E RLO.", '{"v":2,"n":"a\u202eb","items":[]}')
    neg("n-bidi-2066", "Name with U+2066 LRI.", '{"v":2,"n":"a\u2066b","items":[]}')
    neg("n-bidi-2069", "Name with U+2069 PDI.", '{"v":2,"n":"a\u2069b","items":[]}')
    neg("lone-surrogate-escaped", "Escaped lone high surrogate in a name (JSON.parse accepts it).",
        '{"v":2,"n":"a\\ud800","items":[]}')
    neg("lone-surrogate-escaped-low-in-secret", "Escaped lone low surrogate in a secret.",
        '{"v":1,"items":[{"l":"a","s":"\\udc00"}]}')
    neg("lone-surrogate-raw-bytes", "UTF-8-encoded surrogate bytes ED A0 80 (ill-formed UTF-8).",
        b'{"v":1,"items":[{"l":"a","s":"\xed\xa0\x80"}]}')
    neg("escaped-surrogate-pair", "A well-formed pair written as \\ud83d\\ude00 (canonical form is raw UTF-8).",
        '{"v":1,"items":[{"l":"a","s":"\\ud83d\\ude00"}]}')
    neg("invalid-utf8", "Byte 0xFF.", b'{"v":1,"items":[{"l":"a","s":"\xff"}]}')
    neg("overlong-utf8", "Overlong encoding C0 AF of '/'.", b'{"v":1,"items":[{"l":"a","s":"\xc0\xaf"}]}')
    neg("utf8-bom", "Leading UTF-8 BOM (TextDecoder strips it by default: compare bytes, not text).",
        b"\xef\xbb\xbf" + b'{"v":1,"items":' + I1.encode() + b"}")
    neg("escape-solidus", "Non-canonical escape \\/.", '{"v":1,"items":[{"l":"a","s":"\\/"}]}')
    neg("escape-unneeded-u", "Non-canonical escape \\u0041 for 'A'.", '{"v":1,"items":[{"l":"a","s":"\\u0041"}]}')
    neg("escape-uppercase-hex", "\\u001F instead of \\u001f.", '{"v":1,"items":[{"l":"a","s":"\\u001F"}]}')
    neg("escape-u-newline", "\\u000a instead of \\n.", '{"v":1,"items":[{"l":"a","s":"\\u000a"}]}')
    neg("escape-non-ascii", "\\u00e9 instead of raw UTF-8.", '{"v":1,"items":[{"l":"a","s":"\\u00e9"}]}')
    neg("extra-member-top", "Unknown top-level key in v2.", '{"v":2,"items":[],"x":1}')
    neg("extra-member-item", "Unknown key in an item.", '{"v":1,"items":[{"l":"a","s":"b","t":"c"}]}')
    neg("v1-with-n", "v1 has no n.", '{"v":1,"n":"a","items":' + I1 + '}')
    neg("v1-with-a", "v1 has no a.", '{"v":1,"a":true,"items":' + I1 + '}')
    neg("v1-empty-items", "v1 requires at least one item.", '{"v":1,"items":[]}')
    neg("whitespace-after-comma", "A space between members.", '{"v":2, "items":[]}')
    neg("whitespace-leading", "Leading space.", ' {"v":2,"items":[]}')
    neg("whitespace-trailing-newline", "Trailing newline.", '{"v":2,"items":[]}\n')
    neg("whitespace-after-colon", "A space after a colon.", '{"v":1,"items": ' + I1 + '}')
    neg("member-order-a-before-n", "a before n.", '{"v":2,"a":true,"n":"x","items":[]}')
    neg("member-order-items-before-v", "v1 with items before v.", '{"items":' + I1 + ',"v":1}')
    neg("member-order-z-before-items", "z before items.", '{"v":2,"z":"0","items":[]}')
    neg("member-order-s-before-l", "s before l in an item.", '{"v":1,"items":[{"s":"b","l":"a"}]}')
    neg("v-string", '"v":"2".', '{"v":"2","items":[]}')
    neg("v-float", '"v":2.0.', '{"v":2.0,"items":[]}')
    neg("v-exponent", '"v":1e0.', '{"v":1e0,"items":' + I1 + '}')
    neg("v-true", '"v":true.', '{"v":true,"items":' + I1 + '}')
    neg("v-zero", '"v":0 is not a newer version.', '{"v":0,"items":[]}')
    neg("v-negative", '"v":-1.', '{"v":-1,"items":[]}')
    neg("v-missing", "No v.", '{"items":' + I1 + '}')
    neg("v-3", '"v":3: a newer version.', '{"v":3,"items":[]}', UNKNOWN_VERSION)
    neg("v-3-unknown-fields", '"v":3 with fields this version does not know.',
        '{"v":3,"q":[1,2],"items":{}}', UNKNOWN_VERSION)
    neg("v-10", '"v":10.', '{"v":10}', UNKNOWN_VERSION)
    neg("v-3-precedes-validation", "The version prefix is checked before parsing: a v3 prefix wins over a "
        "later duplicate v.", '{"v":3,"v":2,"items":[]}', UNKNOWN_VERSION)
    neg("v-3-not-first", '"v":3 not at the start: no version prefix, so MALFORMED.',
        '{"items":[],"v":3}')
    neg("v-3-whitespace", "Whitespace before a v3: no version prefix, so MALFORMED.", '{ "v":3,"items":[]}')
    neg("v-03", '"v":03 (leading zero, invalid JSON).', '{"v":03,"items":[]}')
    neg("z-non-zero", "z with a character other than 0.", '{"v":2,"a":true,"items":[],"z":"001"}')
    neg("z-empty", "Empty z.", '{"v":2,"a":true,"items":[],"z":""}')
    neg("z-number", "Numeric z.", '{"v":2,"a":true,"items":[],"z":0}')
    neg("z-with-items", "z next to a non-empty items.", '{"v":2,"items":' + I1 + ',"z":"0"}')
    neg("z-in-v1", "v1 has no z.", '{"v":1,"items":' + I1 + ',"z":"0"}')
    neg("label-65-code-points", "Label of 65 code points.", '{"v":1,"items":[{"l":"' + "x" * 65 + '","s":"b"}]}')
    neg("label-number", "Non-string label.", '{"v":1,"items":[{"l":1,"s":"b"}]}')
    neg("secret-null", "Null s.", '{"v":1,"items":[{"l":"a","s":null}]}')
    neg("item-missing-s", "Item without s.", '{"v":1,"items":[{"l":"a"}]}')
    neg("items-object", "items is not an array.", '{"v":2,"items":{}}')
    neg("items-missing", "No items.", '{"v":2,"n":"a"}')
    neg("item-array", "An item that is an array.", '{"v":1,"items":[["a","b"]]}')
    neg("top-level-array", "Top level is an array.", '[{"v":1}]')
    neg("top-level-null", "Top level is null.", "null")
    neg("empty-input", "Zero bytes.", b"")
    neg("not-json", "Not JSON.", "abc")
    neg("nan", "NaN is not JSON (Python's json accepts it unless refused).", '{"v":NaN,"items":[]}')
    neg("trailing-garbage", "Bytes after the object.", '{"v":2,"items":[]}x')
    neg("deep-nesting", "A deeply nested secret (must be rejected, never crash).",
        '{"v":1,"items":[{"l":"a","s":' + "[" * 2000 + "]" * 2000 + "}]}")

    # -------------------------------------------------------------- writer
    writer: list[dict] = []

    def wr(id_: str, desc: str, name: str | None, archived: bool, items: list[dict], pad: str | None) -> None:
        out = write(name, archived, items, pad)
        p = decode(out)
        writer.append({"id": id_, "description": desc,
                       "input": {"name": name, "archived": archived, "items": items, "pad": pad},
                       "expectedVersion": p["version"], "expectedHex": out.hex(), "expectedText": text_of(out)})

    wr("writer-unnamed-active-v1", "No name, active, items: v1, byte-identical to today's encoding (D2).",
       None, False, ITEMS_SINGLE, None)
    wr("writer-unnamed-active-multi-v1", "Same rule with two items.", None, False, ITEMS_MULTI, None)
    wr("writer-named-v2", "A name forces v2.", "Family", False, ITEMS_MULTI, None)
    wr("writer-archived-v2", "The archived flag forces v2.", None, True, ITEMS_SINGLE, None)
    wr("writer-empty-items-v2", "No items forces v2 (v1 needs at least one).", None, False, [], None)
    wr("writer-cleared-v2", "Archive and clear output.", "Family", True, [], "0" * 12)
    wr("writer-unarchived-cleared-v2", "Unarchiving a cleared vault keeps z.", "Family", False, [], "0" * 12)

    # ------------------------------------------------------ archive and clear
    archive_clear: list[dict] = []

    def ac(id_: str, desc: str, previous: bytes, max_payload: int, rule: str) -> None:
        out = clear(previous, max_payload)
        p = decode(out)
        assert padded_len(len(out)) >= padded_len(len(previous)), id_
        archive_clear.append({
            "id": id_, "description": desc, "rule": rule,
            "previousHex": previous.hex(), "previousLength": len(previous), "maxPayloadBytes": max_payload,
            "clearedWithoutPadLength": len(write(p["name"], True, [], None)),
            "expectedHex": out.hex(), "expectedText": text_of(out), "expectedLength": len(out),
            "expectedPadLength": len(p["pad"]) if p["pad"] else 0,
        })

    three = v2("Family", False, ITEMS_THREE)
    ac("clear-named-three-items", "Named vault with three items: same payload length.", three, 638, "exact")
    ac("clear-v1-two-items", "Unnamed v1 vault: v2 cleared payload of the same length.",
       write(None, False, ITEMS_MULTI, None), 638, "exact")
    ac("clear-already-archived", "Named archived vault.", v2("Old", True, ITEMS_SINGLE), 638, "exact")
    # previous length = C0 + 8: z of exactly one 0
    c0_unnamed = len(write(None, True, [], None))
    prev_k1 = write(None, False, [item("", "x" * (c0_unnamed + 8 - 33))], None)
    assert len(prev_k1) == c0_unnamed + 8
    ac("clear-exact-one-zero", "Previous length is C0 + 8: z is a single 0.", prev_k1, 638, "exact")
    ac("clear-tiny-gap", "Tiny v1 vault, C0 < previous < C0 + 8: z of one 0, so the payload is slightly longer, never shorter.",
       write(None, False, [item("", "")], None), 638, "gap-one-zero")
    ac("clear-recleared-unarchived", "An unarchived cleared vault with z of one 0: C0 >= previous, no z.",
       v2(None, False, [], "0"), 638, "no-pad")
    ac("clear-recleared-equal", "An unarchived cleared vault with z of two 0s: C0 == previous, no z.",
       v2(None, False, [], "00"), 638, "no-pad")
    # Capacity fallback (spec 8, step 4): C0 < previous < C0 + 8 and C0 + 8 > maxPayloadBytes.
    nm = "N" * 22
    prev_cap = v2(nm, False, [item("", "")])
    assert len(prev_cap) == 62 and len(write(nm, True, [], None)) == 56
    ac("clear-gap-at-capacity", "Hypothetical 62-byte capacity, previous at capacity: C0 + 8 does not fit, so no z; "
       "the padded length is unchanged.", prev_cap, 62, "gap-no-room")

    # ------------------------------------------------------------- blobs
    A, B = gv.CREDS["A"], gv.CREDS["B"]
    payload_hex = {c["id"]: c["hex"] for c in positive}
    payload_hex.update({c["id"]: c["expectedHex"] for c in archive_clear})
    blobs: list[dict] = []
    blob_bytes: dict[str, bytes] = {}

    def blob_vec(id_: str, desc: str, payload_id: str, updates: str | None = None,
                 same_length_as: str | None = None) -> None:
        payload = bytes.fromhex(payload_hex[payload_id])
        creds = [A, B]
        if updates is None:
            vid = gv.det(f"payload-v2/blob/{id_}/vaultId", 32)
            rng = (gv.det(f"payload-v2/blob/{id_}/wrapSalt", 32) + gv.det(f"payload-v2/blob/{id_}/dataKey", 32)
                   + b"".join(gv.det(f"payload-v2/blob/{id_}/wrapNonce/{i}", 12) for i in range(2))
                   + gv.det(f"payload-v2/blob/{id_}/payloadNonce", 12))
            out = gv.create_vault(vid, gv.RP_ID, creds, payload, gv.MODE_ANY, 1, rng, None)["blob"]
        else:
            vid = bytes.fromhex(next(b["vaultId"] for b in blobs if b["id"] == updates))
            rng = gv.det(f"payload-v2/blob/{id_}/payloadNonce", 12)
            out = gv.update_payload(blob_bytes[updates], [{"prf": A["prf"]}], vid, payload, rng)
        for c in creds:
            assert gv.open_vault(out, [{"prf": c["prf"]}], vid) == payload
        decode(payload)
        if same_length_as is not None:
            assert len(out) == len(blob_bytes[same_length_as]), id_
        blob_bytes[id_] = out
        blobs.append({
            "id": id_, "description": desc, "payloadVector": payload_id, "payloadHex": payload.hex(),
            "vaultId": vid.hex(), "rpId": gv.RP_ID.decode(), "mode": gv.MODE_ANY, "threshold": 1,
            "credentials": [{"name": n, "id": c["id"].hex(), "prf": c["prf"].hex()} for n, c in (("A", A), ("B", B))],
            "updates": updates, "sameLengthAs": same_length_as, "rng": rng.hex(),
            "blob": out.hex(), "blobLength": len(out),
        })

    blob_vec("blob-v1-minimal", "v1 payload (the minimal-version writer's output for an unnamed active vault), "
             "keys A+B.", "v1-multi")
    blob_vec("blob-v2-named", "Named v2 payload, keys A+B.", "v2-named")
    blob_vec("blob-v2-named-archived", "Named, archived v2 payload, keys A+B.", "v2-named-archived")
    blob_vec("blob-v2-name-non-bmp", "v2 payload with a non-BMP name, keys A+B.", "v2-name-non-bmp")
    blob_vec("blob-v2-empty-items", "v2 payload with no items, keys A+B.", "v2-empty-items")
    pos_three = "v2-named-three-items"
    positive.append({"id": pos_three, "description": "Named vault with three items (the Archive and clear "
                     "starting point).", "hex": three.hex(), "text": text_of(three),
                     "decoded": decoded_json(decode(three)), "canonicalHex": three.hex()})
    payload_hex[pos_three] = three.hex()
    blob_vec("blob-clear-before", "Named vault with three items, keys A+B (before Archive and clear).", pos_three)
    blob_vec("blob-clear-after", "Archive and clear of blob-clear-before by key A (updatePayload): the blob "
             "length is unchanged.", "clear-named-three-items", updates="blob-clear-before",
             same_length_as="blob-clear-before")

    return {
        "name": "cryoshield-payload-v2",
        "formatVersion": 2,
        "spec": "docs/spec/payload-v2.md",
        "generatedBy": "packages/vault-crypto/scripts/gen-payload-vectors.py",
        "encoding": ("hex: lowercase hex of the exact payload bytes. text: the same bytes as a string when they are "
                     "well-formed UTF-8, else null. decoded: {version, name|null, archived, items:[{l,s}], pad|null}. "
                     "canonicalHex: the canonical re-encoding (equal to hex for positive vectors; for negative "
                     "vectors that parse and validate but differ byte-wise, what the re-encoding produced, else "
                     "null). Blob vectors use credentials A and B of packages/vault-crypto/test-vectors/v1.json."),
        "errorClasses": [MALFORMED, UNKNOWN_VERSION],
        "constants": {
            "maxNameCodePoints": MAX_NAME_CPS, "maxLabelCodePoints": MAX_LABEL_CPS,
            "forbiddenNameRanges": ["U+0000-U+001F", "U+007F-U+009F", "U+2028-U+2029", "U+202A-U+202E",
                                    "U+2066-U+2069"],
            "versionPrefixRegex": VERSION_PREFIX.pattern, "archiveReserveBytes": len(',"a":true'),
            "padMemberOverheadBytes": len(',"z":""'),
        },
        "positive": positive,
        "negative": negative,
        "writer": writer,
        "archiveClear": archive_clear,
        "blobs": blobs,
    }


def render() -> str:
    return json.dumps(build(), indent=2, ensure_ascii=True) + "\n"


def main() -> int:
    text = render()
    args = sys.argv[1:]
    if "--stdout" in args:
        sys.stdout.write(text)
        return 0
    if "--check" in args:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if current != text:
            print(f"MISMATCH: {OUT} differs from a fresh generation", file=sys.stderr)
            return 1
        print(f"OK: {OUT} is byte-identical to a fresh generation")
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT} ({len(text)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

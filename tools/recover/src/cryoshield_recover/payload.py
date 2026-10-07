"""Vault payload codec, v1 and v2 (``docs/spec/payload-v2.md``; OpenSpec change vault-list-labels-archive,
design D1-D4, task 1.3).

An independent second implementation of the web app's ``apps/web/src/vault/payload.ts``. Both must pass
every vector in ``docs/spec/payload-vectors.json`` (pinned by SHA-256 in the tests).

- v1 decodes with the deployed lenient rules (spec 7.1): any member order and whitespace, any escape, the
  last duplicate member wins (``json.loads``' default, like ``JSON.parse``), one leading BOM stripped,
  escaped unpaired surrogates accepted. A vault that opens today keeps opening.
- v2 is strict and canonical (spec 7.2): validate, re-encode, and compare with the input bytes.
- A nesting-depth scan runs before parsing, so Python's recursive parser and ``JSON.parse`` agree.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from typing import Any, Final, Literal

ErrorCode = Literal["MALFORMED", "UNKNOWN_VERSION"]
MALFORMED: Final = "MALFORMED"
UNKNOWN_VERSION: Final = "UNKNOWN_VERSION"
MAX_DEPTH = 64
MAX_NAME_CODE_POINTS = 40
MAX_LABEL_CODE_POINTS = 64


class PayloadError(Exception):
    """A payload that is not a valid v1 or v2 payload. ``code`` is MALFORMED or UNKNOWN_VERSION.

    The message never contains payload content (it can hold secrets)."""

    def __init__(self, code: ErrorCode, reason: str) -> None:
        super().__init__(f"{code}: {reason}")
        self.code: ErrorCode = code


@dataclass
class Item:
    l: str  # noqa: E741 - the wire name; label
    s: str  # secret


@dataclass
class VaultPayload:
    version: int  # 1 or 2 when decoded; ignored by ``write``
    name: str | None = None
    archived: bool = False
    items: list[Item] = field(default_factory=list)
    pad: str | None = None


def _is_surrogate(ch: str) -> bool:
    return 0xD800 <= ord(ch) <= 0xDFFF


def _well_formed(s: str) -> bool:
    return not any(_is_surrogate(ch) for ch in s)


def _forbidden_in_name(ch: str) -> bool:
    """Spec 4.3: C0, DEL, C1, ALM, LRM/RLM, U+2028/9, bidi embeddings/overrides/isolates, U+206A-F."""
    o = ord(ch)
    return (
        o <= 0x1F
        or 0x7F <= o <= 0x9F
        or o == 0x061C
        or o in (0x200E, 0x200F)
        or 0x2028 <= o <= 0x202E
        or 0x2066 <= o <= 0x206F
    )


def name_problem(name: str) -> str | None:
    """Why ``name`` breaks spec 4.3, or None if it is valid."""
    if not 1 <= len(name) <= MAX_NAME_CODE_POINTS:
        return f"a name must be 1 to {MAX_NAME_CODE_POINTS} characters"
    if not _well_formed(name):
        return "a name must be well-formed Unicode"
    if any(_forbidden_in_name(ch) for ch in name):
        return "a name must not contain control, direction or format characters"
    return None


# ------------------------------------------------------------------ encoding (spec 5)
def _dumps(obj: Any) -> bytes:
    text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    # json.dumps leaves an unpaired surrogate as a raw code point; JSON.stringify writes \udxxx (v1 only).
    text = "".join(f"\\u{ord(ch):04x}" if _is_surrogate(ch) else ch for ch in text)
    return text.encode("utf-8")


def _obj(p: VaultPayload, version: int) -> dict[str, Any]:
    obj: dict[str, Any] = {"v": version}
    if version == 2:
        if p.name is not None:
            obj["n"] = p.name
        if p.archived:
            obj["a"] = True
    obj["items"] = [{"l": i.l, "s": i.s} for i in p.items]
    if version == 2 and p.pad is not None:
        obj["z"] = p.pad
    return obj


def encode(p: VaultPayload) -> bytes:
    """The canonical bytes of ``p`` at its own ``version`` (spec 5)."""
    if p.version not in (1, 2):
        raise ValueError("version must be 1 or 2")
    return _dumps(_obj(p, p.version))


def write(p: VaultPayload) -> bytes:
    """The minimal-version writer (spec 6, D2): v1 when unnamed, active, unpadded and non-empty; else v2.
    A v2 payload must be valid (spec 3 and 4); otherwise ValueError, and nothing is written."""
    if p.name is None and not p.archived and p.pad is None and p.items:
        return _dumps(_obj(p, 1))
    out = _dumps(_obj(p, 2))
    try:
        decode(out)  # the writer emits only what the strict decoder accepts
    except PayloadError:
        raise ValueError("this vault can't be written as v2 (invalid name, label or text)") from None
    return out


# ------------------------------------------------------------------ decoding (spec 7)
def _depth_ok(text: str) -> bool:
    """Spec 7 step 2: open arrays/objects outside strings never exceed MAX_DEPTH."""
    depth = 0
    in_string = escaped = False
    for ch in text:
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
        elif ch == '"':
            in_string = True
        elif ch in "[{":
            depth += 1
            if depth > MAX_DEPTH:
                return False
        elif ch in "]}":
            depth -= 1
    return True


def _no_constants(name: str) -> Any:
    raise ValueError(f"{name} is not JSON")


def _is_number(v: Any) -> bool:
    return type(v) in (int, float)  # excludes bool, which Python treats as an int


def _item(raw: Any, *, strict: bool) -> Item:
    if not isinstance(raw, dict) or set(raw) != {"l", "s"}:
        raise PayloadError(MALFORMED, "an item must have exactly l and s")
    label, secret = raw["l"], raw["s"]
    if type(label) is not str or type(secret) is not str:
        raise PayloadError(MALFORMED, "l and s must be strings")
    if len(label) > MAX_LABEL_CODE_POINTS:
        raise PayloadError(MALFORMED, "label too long")
    if strict and not (_well_formed(label) and _well_formed(secret)):
        raise PayloadError(MALFORMED, "v2 strings must be well-formed")
    return Item(label, secret)


def _v1(obj: dict[str, Any]) -> VaultPayload:
    if set(obj) != {"v", "items"}:
        raise PayloadError(MALFORMED, "v1 has exactly v and items")
    items = obj["items"]
    if not isinstance(items, list) or not items:
        raise PayloadError(MALFORMED, "v1 items must be a non-empty array")
    return VaultPayload(1, None, False, [_item(i, strict=False) for i in items], None)


def _v2(obj: dict[str, Any], data: bytes) -> VaultPayload:
    if not set(obj) <= {"v", "n", "a", "items", "z"} or "items" not in obj:
        raise PayloadError(MALFORMED, "unexpected or missing v2 members")
    name = obj.get("n")
    if "n" in obj and (type(name) is not str or name_problem(name) is not None):
        raise PayloadError(MALFORMED, "invalid name")
    archived = obj.get("a")
    if "a" in obj and not (type(archived) is bool and archived is True):
        raise PayloadError(MALFORMED, "a must be the literal true")
    items = obj["items"]
    if not isinstance(items, list):
        raise PayloadError(MALFORMED, "items must be an array")
    pad = obj.get("z")
    if "z" in obj and (type(pad) is not str or not pad or set(pad) != {"0"} or items):
        raise PayloadError(MALFORMED, "z must be zeros, and only with no items")
    p = VaultPayload(2, name, "a" in obj, [_item(i, strict=True) for i in items], pad)
    if encode(p) != data:
        raise PayloadError(MALFORMED, "v2 must be canonical")
    return p


def decode(data: bytes) -> VaultPayload:
    """Bytes to a VaultPayload, or PayloadError (MALFORMED / UNKNOWN_VERSION). Never a partial result."""
    try:
        text = bytes(data).decode("utf-8")
    except UnicodeDecodeError:
        raise PayloadError(MALFORMED, "not UTF-8") from None
    if text.startswith("﻿"):
        text = text[1:]  # exactly one, as TextDecoder does
    if not _depth_ok(text):
        raise PayloadError(MALFORMED, "nested too deeply")
    try:
        obj = json.loads(text, parse_constant=_no_constants)
    except (ValueError, RecursionError):
        raise PayloadError(MALFORMED, "not JSON") from None
    if not isinstance(obj, dict) or not _is_number(obj.get("v")):
        raise PayloadError(MALFORMED, "no numeric v")
    v = obj["v"]
    if isinstance(v, float) and not math.isfinite(v):
        raise PayloadError(UNKNOWN_VERSION, "unknown version")
    if v == 1:
        return _v1(obj)
    if v == 2:
        return _v2(obj, bytes(data))
    raise PayloadError(UNKNOWN_VERSION, "unknown version")


# ------------------------------------------------------------------ archive and clear (spec 8)
def archive_clear(prev: bytes, max_payload_bytes: int) -> bytes:
    """The cleared payload for Archive and clear, sized so the blob keeps its length (spec 8, D4)."""
    previous = decode(prev)
    p_len = len(prev)
    base = VaultPayload(2, previous.name, True, [], None)
    c0 = len(encode(base))
    block_end = 64 * math.ceil((p_len + 2) / 64) - 2
    if p_len - c0 - 7 >= 1:
        base.pad = "0" * (p_len - c0 - 7)
    elif c0 < p_len and c0 + 8 <= block_end:
        base.pad = "0"
    out = encode(base)
    if len(out) > max_payload_bytes:
        raise ValueError("vault too large")
    return out

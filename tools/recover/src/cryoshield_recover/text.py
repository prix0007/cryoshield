"""Make remote-sourced text inert before it reaches a terminal."""

from __future__ import annotations

import unicodedata

_KEEP = {"\n", "\t"}
# ZERO WIDTH NON-JOINER and JOINER: emoji sequences and several scripts need them (allowed in names).
_JOINERS = {"\u200c", "\u200d"}


def sanitize(text: str, max_len: int | None = None) -> str:
    """Drop C0/C1 controls (ESC, BEL, CSI, CR...), DEL, and Unicode format characters (bidi overrides).

    Removing the introducer characters makes any ANSI/OSC sequence inert: what is left is plain text.
    """
    out = "".join(
        ch for ch in text if ch in _KEEP or ch in _JOINERS or not unicodedata.category(ch).startswith("C")
    )
    if max_len is not None and len(out) > max_len:
        out = out[:max_len] + "…"
    return out


# Display-time rules for vault names and labels (vault-list-labels-archive, review of task 1.1 and the
# ECC review of c9830c1): strip every character of categories Cc, Cf, Zl and Zp (except ZWJ and ZWNJ,
# which emoji sequences and several scripts need, and which the codec allows), cap runs of combining
# marks, and render unpaired surrogates (possible in v1) as \udxxx escapes ("backslashreplace").
_INVISIBLE = {"Cc", "Cf", "Zl", "Zp"}
# A name is "Unnamed vault" unless it has a character outside these categories, and not one of the
# blank-looking letters and symbols below (Hangul fillers, Braille blank, Khmer inherent vowels).
_NOT_VISIBLE = {"Cc", "Cf", "Zl", "Zp", "Zs", "Mn", "Me", "Co", "Cn", "Cs"}
_BLANK = {0x115F, 0x1160, 0x17B4, 0x17B5, 0x2800, 0x3164, 0xFFA0}
MAX_COMBINING_RUN = 3
UNNAMED = "Unnamed vault"


def _surrogates_escaped(text: str) -> str:
    return text.encode("utf-8", "backslashreplace").decode("utf-8")


def inert_label(text: str) -> str:
    """A name or label made inert: control/format/separator characters removed (joiners kept), runs of
    combining marks capped, unpaired surrogates escaped."""
    out: list[str] = []
    run = 0
    for ch in text:
        cat = unicodedata.category(ch)
        if cat in _INVISIBLE and ch not in _JOINERS:
            continue
        run = run + 1 if cat in ("Mn", "Me") else 0
        if run > MAX_COMBINING_RUN:
            continue
        out.append(ch)
    return _surrogates_escaped("".join(out))


def has_visible(text: str) -> bool:
    return any(unicodedata.category(ch) not in _NOT_VISIBLE and ord(ch) not in _BLANK for ch in text)


def display_name(name: str | None) -> str:
    """The vault's name, quoted (repr-style, so it can never pass as a status or another field), or
    "Unnamed vault" (unquoted) when there is none or nothing visible is left."""
    shown = inert_label(name) if name else ""
    if not has_visible(shown):
        return UNNAMED
    return '"' + shown.replace("\\", "\\\\").replace('"', '\\"') + '"'


def truncate(text: str, limit: int) -> str:
    """At most ``limit`` code points (Python strings index code points, so pairs are never split)."""
    return text if len(text) <= limit else text[: limit - 1] + "…"


def inert_secret(text: str) -> tuple[str, bool]:
    r"""A secret shown exactly but inertly, and whether anything was escaped. Line breaks and tabs are
    kept; a backslash becomes \\, every other invisible or control character a visible \uXXXX escape,
    and an unpaired surrogate \udxxx. So the shown text is unambiguous; --output gives the exact bytes."""
    out = []
    escaped = False
    for ch in text:
        if ch == "\\":
            out.append("\\\\")
            escaped = True
        elif ch not in _KEEP and unicodedata.category(ch) in _INVISIBLE:
            o = ord(ch)
            out.append(f"\\u{o:04x}" if o <= 0xFFFF else f"\\U{o:08x}")
            escaped = True
        elif 0xD800 <= ord(ch) <= 0xDFFF:
            out.append(f"\\u{ord(ch):04x}")
            escaped = True
        else:
            out.append(ch)
    return "".join(out), escaped

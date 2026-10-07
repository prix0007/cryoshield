"""Make remote-sourced text inert before it reaches a terminal."""

from __future__ import annotations

import unicodedata

_KEEP = {"\n", "\t"}


def sanitize(text: str, max_len: int | None = None) -> str:
    """Drop C0/C1 controls (ESC, BEL, CSI, CR...), DEL, and Unicode format characters (bidi overrides).

    Removing the introducer characters makes any ANSI/OSC sequence inert: what is left is plain text.
    """
    out = "".join(ch for ch in text if ch in _KEEP or not unicodedata.category(ch).startswith("C"))
    if max_len is not None and len(out) > max_len:
        out = out[:max_len] + "…"
    return out


# Display-time rules for vault names and labels (vault-list-labels-archive, review of task 1.1): strip
# every character of categories Cc, Cf, Zl and Zp, and render unpaired surrogates (possible in v1 labels
# and secrets) as \udxxx escapes ("backslashreplace") instead of failing to print.
_INVISIBLE = {"Cc", "Cf", "Zl", "Zp"}
UNNAMED = "Unnamed vault"


def _surrogates_escaped(text: str) -> str:
    return text.encode("utf-8", "backslashreplace").decode("utf-8")


def inert_label(text: str) -> str:
    """A name or label made inert: invisible and control characters removed, surrogates escaped."""
    return _surrogates_escaped("".join(ch for ch in text if unicodedata.category(ch) not in _INVISIBLE))


def display_name(name: str | None) -> str:
    """The vault's name for display, or "Unnamed vault" when none (or nothing visible) is left."""
    shown = inert_label(name) if name else ""
    return shown if shown.strip() else UNNAMED


def inert_secret(text: str) -> str:
    """A secret value shown exactly but inertly: line breaks and tabs are kept, every other invisible or
    control character becomes a visible \\uXXXX escape, and unpaired surrogates become \\udxxx."""
    out = []
    for ch in text:
        if ch not in _KEEP and unicodedata.category(ch) in _INVISIBLE:
            o = ord(ch)
            out.append(f"\\u{o:04x}" if o <= 0xFFFF else f"\\U{o:08x}")
        else:
            out.append(ch)
    return _surrogates_escaped("".join(out))

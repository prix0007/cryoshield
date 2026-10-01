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

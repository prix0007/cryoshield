"""Load the normative TypeScript-package vectors (read-only, never edited here)."""

from __future__ import annotations

import hashlib
import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[4]
VECTORS_PATH = Path(
    os.environ.get("CRYOSHIELD_VECTORS", REPO_ROOT / "packages" / "vault-crypto" / "test-vectors" / "v1.json")
)

# Pinned SHA-256 of v1.json. Changing the vectors must be a deliberate act: update this pin
# only after re-reading docs/spec/vault-format-v1.md and the vector diff.
PINNED_SHA256 = "67c790c973dd304a04ba64f6c36b5cda724fb1bbc0b94d1b5afb0ecb6b994d18"


def h(s: str | None) -> bytes:
    return bytes.fromhex(s) if s else b""


@lru_cache(maxsize=1)
def raw_bytes() -> bytes:
    return VECTORS_PATH.read_bytes()


@lru_cache(maxsize=1)
def load() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(raw_bytes())
    return data


def sha256_of_file() -> str:
    return hashlib.sha256(raw_bytes()).hexdigest()


def cases(section: str) -> list[dict[str, Any]]:
    return list(load()[section])


def ids(section: str) -> list[str]:
    return [c["name"] for c in cases(section)]

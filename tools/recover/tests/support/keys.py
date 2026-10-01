"""A vector-backed stand-in for a physical FIDO2 key (no hardware)."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from support import vectors
from support.vectors import h

from cryoshield_recover.authenticator import Assertion

_ALL = {c["id"]: c for v in vectors.cases("vaults") for c in v["credentials"]}
BY_NAME: dict[str, dict[str, Any]] = {}
for v in vectors.cases("vaults"):
    for name, c in zip(v["keys"], v["credentials"], strict=True):
        BY_NAME.setdefault(name, c)


@dataclass
class PhysicalKey:
    """One key holding credentials ``(rp_id, cred_id, prf, discoverable)``."""

    creds: list[tuple[str, bytes, bytes, bool]]

    @classmethod
    def named(cls, *names: str, rp_id: str = "cryoshield.app", discoverable: bool = True) -> PhysicalKey:
        return cls([(rp_id, h(BY_NAME[n]["id"]), h(BY_NAME[n]["prf"]), discoverable) for n in names])


@dataclass
class FakePrfSource:
    """Each ``get`` is one tap on the next inserted key (the last key stays inserted)."""

    keys: list[PhysicalKey]
    calls: list[tuple[str, list[bytes] | None]] = field(default_factory=list)
    handed_out: list[bytearray] = field(default_factory=list)
    ui: Any = None

    def get(self, rp_id: str, allow: Sequence[bytes] | None) -> list[Assertion]:
        key = self.keys[min(len(self.calls), len(self.keys) - 1)]
        self.calls.append((rp_id, list(allow) if allow else None))
        if self.ui is not None:
            self.ui.ask_pin(8)
        out = []
        for rp, cid, prf, disc in key.creds:
            if rp != rp_id:
                continue
            if allow and cid not in allow:
                continue
            if not allow and not disc:
                continue
            buf = bytearray(prf)
            self.handed_out.append(buf)
            out.append(Assertion(cid, buf))
        return out

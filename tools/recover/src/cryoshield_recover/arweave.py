"""Arweave fallback: find mirrored vault blobs by tag and fetch them with hard size caps.

Tag schema (design D5; the durability-layer mirror must write these):
  App-Name: CryoShield
  CryoShield-Format: 1
  CryoShield-Vault-Id: 0x<64 lowercase hex>
  CryoShield-Locator: 0x<64 lowercase hex>    (one tag per locator)
  CryoShield-Version: <uint>
GraphQL servers and gateways are untrusted; returned tags are re-checked locally.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from .net import NetError, TooLarge, check_url, get_capped, host_of, post_json

APP_NAME = "CryoShield"
MAX_BLOB = 1024
MAX_GRAPHQL_RESPONSE = 256 * 1024
_TXID = re.compile(r"^[A-Za-z0-9_-]{43}$")
_HEX32 = re.compile(r"^0x[0-9a-f]{64}$")

QUERY = (
    "query($tags:[TagFilter!]){transactions(tags:$tags,first:50,sort:HEIGHT_DESC)"
    "{edges{node{id data{size} block{height} tags{name value}}}}}"
)


@dataclass
class ArweaveTx:
    id: str
    size: int
    height: int | None
    vault_id: bytes | None
    version: int | None
    locators: list[bytes] = field(default_factory=list)


def _as_int(value: Any) -> int | None:
    """A small non-negative integer from untrusted JSON (int or decimal string), else None.

    Rejects bools, floats (incl. NaN/Infinity), and absurdly long numbers.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if 0 <= value < 10**15 else None
    if isinstance(value, str) and value.isascii() and value.isdigit() and len(value) <= 15:
        return int(value)
    return None


def hex32(b: bytes) -> str:
    return "0x" + b.hex()


class Arweave:
    def __init__(
        self, graphql_urls: Sequence[str], gateway_urls: Sequence[str], *, timeout: float = 15.0
    ) -> None:
        self.graphql = [check_url(u) for u in graphql_urls]
        self.gateways = [check_url(u) for u in gateway_urls]
        self.timeout = timeout
        self.warnings: list[str] = []

    def _query(self, tags: list[dict[str, Any]]) -> list[ArweaveTx]:
        found: dict[str, ArweaveTx] = {}
        for url in self.graphql:
            try:
                resp = post_json(
                    url,
                    {"query": QUERY, "variables": {"tags": tags}},
                    timeout=self.timeout,
                    max_bytes=MAX_GRAPHQL_RESPONSE,
                )
                txs = self._parse(resp)
            except NetError as e:
                self.warnings.append(f"Arweave search {host_of(url)} failed ({e})")
                continue
            except Exception as e:  # noqa: BLE001 - one hostile server must never stop recovery
                self.warnings.append(
                    f"Arweave search {host_of(url)} returned malformed data ({type(e).__name__}); ignored"
                )
                continue
            for tx in txs:
                # Servers are untrusted and may disagree about the same tx. The size is only advisory
                # (downloads are hard-capped anyway), so keep the smallest claim: one server cannot make
                # us skip a genuine transaction by inflating its size.
                prev = found.get(tx.id)
                if prev is None or tx.size < prev.size:
                    found[tx.id] = tx
        return sorted(found.values(), key=lambda t: -(t.height or 0))

    @staticmethod
    def _parse(resp: Any) -> list[ArweaveTx]:
        edges = resp["data"]["transactions"]["edges"]
        if not isinstance(edges, list):
            raise TypeError("edges")
        out: list[ArweaveTx] = []
        for edge in edges[:50]:
            try:
                tx = Arweave._parse_node(edge["node"])
            except (KeyError, TypeError, ValueError, AttributeError, OverflowError):
                continue  # skip one malformed node, keep the rest
            if tx is not None:
                out.append(tx)
        return out

    @staticmethod
    def _parse_node(node: Any) -> ArweaveTx | None:
        txid = node["id"]
        if not isinstance(txid, str) or not _TXID.match(txid):
            return None
        tags: dict[str, list[str]] = {}
        for t in (node.get("tags") or [])[:64]:
            name, value = t["name"], t["value"]
            if isinstance(name, str) and isinstance(value, str):
                tags.setdefault(name, []).append(value)
        if APP_NAME not in tags.get("App-Name", []):
            return None
        size = _as_int(node["data"]["size"])
        if size is None:
            return None
        vid = next((v for v in tags.get("CryoShield-Vault-Id", []) if _HEX32.match(v)), None)
        ver = next((v for v in tags.get("CryoShield-Version", []) if _as_int(v) is not None), None)
        block = node.get("block")
        height = _as_int(block.get("height")) if isinstance(block, dict) else None
        return ArweaveTx(
            id=txid,
            size=size,
            height=height,
            vault_id=bytes.fromhex(vid[2:]) if vid else None,
            version=_as_int(ver) if ver else None,
            locators=[bytes.fromhex(x[2:]) for x in tags.get("CryoShield-Locator", []) if _HEX32.match(x)],
        )

    def find_by_locator(self, locator: bytes) -> list[ArweaveTx]:
        txs = self._query(
            [
                {"name": "App-Name", "values": [APP_NAME]},
                {"name": "CryoShield-Locator", "values": [hex32(locator)]},
            ]
        )
        return [t for t in txs if locator in t.locators]

    def find_by_vault_id(self, vault_id: bytes) -> list[ArweaveTx]:
        txs = self._query(
            [
                {"name": "App-Name", "values": [APP_NAME]},
                {"name": "CryoShield-Vault-Id", "values": [hex32(vault_id)]},
            ]
        )
        return [t for t in txs if t.vault_id == vault_id]

    def fetch(self, tx: ArweaveTx) -> bytes | None:
        if tx.size > MAX_BLOB or tx.size <= 0:
            self.warnings.append(f"Arweave tx {tx.id}: size {tx.size} out of range; skipped")
            return None
        for gw in self.gateways:
            try:
                return get_capped(f"{gw}/{tx.id}", timeout=self.timeout, max_bytes=MAX_BLOB)
            except TooLarge:
                self.warnings.append(f"Arweave tx {tx.id}: data larger than {MAX_BLOB} bytes; skipped")
                return None
            except NetError as e:
                self.warnings.append(f"Arweave gateway {host_of(gw)} failed ({e})")
        return None

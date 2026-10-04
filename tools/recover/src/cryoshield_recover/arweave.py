"""Arweave fallback: find mirrored vault blobs by tag and fetch them with hard size caps.

Tag schema (design D5; the durability-layer mirror must write these):
  App-Name: CryoShield
  CryoShield-Format: 1
  CryoShield-Vault-Id: 0x<64 lowercase hex>
  CryoShield-Locator: 0x<64 lowercase hex>    (one tag per locator)
  CryoShield-Version: <uint>
GraphQL servers and gateways are untrusted; returned tags are re-checked locally.

Per-server records (audit REC-M2, change harden-recovery-network-trust): every GraphQL server's record
for a transaction is kept separately, so one server's metadata (size, vault-id tag, locators) can never
replace another's. Claimed sizes are ignored; downloads are hard-capped at 1024 bytes. Search pages
newest-first with cursors within a budget, plus the oldest page, so newer spam cannot bury the original.
"""

from __future__ import annotations

import re
import time
from collections.abc import Iterable, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

from .net import NetError, TooLarge, check_url, get_capped, host_of, post_json

APP_NAME = "CryoShield"
MAX_BLOB = 1024
MAX_GRAPHQL_RESPONSE = 256 * 1024
_TXID = re.compile(r"^[A-Za-z0-9_-]{43}$")
_HEX32 = re.compile(r"^0x[0-9a-f]{64}$")

PAGE_SIZE = 50
ARWEAVE_MAX_PAGES = 10  # newest-first pages per server per query (plus one oldest-first page)
# Each GraphQL server gets its OWN time budget and servers are queried in parallel, so a slow or hostile
# server cannot starve the honest ones (ECC review, PR #22).
ARWEAVE_SERVER_DEADLINE = 30.0
# Downloads: at most this many distinct tx ids per search, within this many seconds (ECC review, PR #22).
MAX_FETCHES = 40
FETCH_DEADLINE = 60.0
_MAX_CURSOR = 512

QUERY = (
    "query($tags:[TagFilter!],$first:Int,$after:String,$sort:SortOrder){"
    "transactions(tags:$tags,first:$first,after:$after,sort:$sort)"
    "{pageInfo{hasNextPage} edges{cursor node{id data{size} block{height} tags{name value}}}}}"
)


@dataclass
class ArweaveTx:
    """One GraphQL server's record of one transaction. ``size`` is the server's claim (informational
    only); ``server`` is the host that reported it."""

    id: str
    size: int | None
    height: int | None
    vault_id: bytes | None
    version: int | None
    locators: list[bytes] = field(default_factory=list)
    server: str = ""


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
        self._data: dict[str, bytes | None] = {}
        # True when any page/time/download budget cut a search short: results may be incomplete.
        self.truncated = False

    def _query(self, tags: list[dict[str, Any]]) -> list[ArweaveTx]:
        """All servers' records, NOT merged across servers (REC-M2). Servers run in parallel, each
        within its own budget; per server the oldest page comes first (it cannot be buried by newer
        spam), then newest-first pages."""

        def server(url: str) -> list[ArweaveTx]:
            deadline = time.monotonic() + ARWEAVE_SERVER_DEADLINE
            oldest = self._pages(url, tags, "HEIGHT_ASC", 1, deadline)
            newest = self._pages(url, tags, "HEIGHT_DESC", ARWEAVE_MAX_PAGES, deadline)
            # Alternate oldest/newest so a download budget reaches both ends first: the original mirror
            # (oldest, cannot be pre-spammed) and the latest update (newest). Security review H2.
            per_server: dict[str, ArweaveTx] = {}
            for i in range(max(len(oldest), len(newest))):
                for lst in (oldest, newest):
                    if i < len(lst):
                        per_server.setdefault(lst[i].id, lst[i])  # one record per (server, tx id)
            return list(per_server.values())

        if not self.graphql:
            return []
        with ThreadPoolExecutor(max_workers=min(8, len(self.graphql))) as ex:
            results = list(ex.map(server, self.graphql))
        # Keep each server's order; fetch_all interleaves servers. No global sort by CLAIMED height.
        return [tx for txs in results for tx in txs]

    def _pages(
        self, url: str, tags: list[dict[str, Any]], sort: str, max_pages: int, deadline: float
    ) -> list[ArweaveTx]:
        host = host_of(url)
        out: list[ArweaveTx] = []
        after: str | None = None
        has_next = False
        for _ in range(max_pages):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                self.warnings.append(f"Arweave search {host}: time budget exhausted")
                self.truncated = True
                return out
            variables: dict[str, Any] = {"tags": tags, "first": PAGE_SIZE, "sort": sort}
            if after is not None:
                variables["after"] = after
            try:
                resp = post_json(
                    url,
                    {"query": QUERY, "variables": variables},
                    timeout=max(0.001, min(self.timeout, remaining)),
                    max_bytes=MAX_GRAPHQL_RESPONSE,
                )
                txs, has_next, cursor = self._parse(resp, host)
            except NetError as e:
                self.warnings.append(f"Arweave search {host} failed ({e})")
                return out
            except Exception as e:  # noqa: BLE001 - one hostile server must never stop recovery
                self.warnings.append(
                    f"Arweave search {host} returned malformed data ({type(e).__name__}); ignored"
                )
                return out
            out.extend(txs)
            if not has_next or cursor is None or cursor == after:
                return out
            after = cursor
        if has_next and sort == "HEIGHT_DESC":
            self.truncated = True
            self.warnings.append(
                f"Arweave search {host}: page budget reached with more results pending; newer copies "
                "may not have been seen"
            )
        return out

    @staticmethod
    def _parse(resp: Any, server: str = "") -> tuple[list[ArweaveTx], bool, str | None]:
        conn = resp["data"]["transactions"]
        edges = conn["edges"]
        if not isinstance(edges, list):
            raise TypeError("edges")
        info = conn.get("pageInfo") if isinstance(conn, dict) else None
        has_next = isinstance(info, dict) and info.get("hasNextPage") is True
        out: list[ArweaveTx] = []
        cursor: str | None = None
        for edge in edges[:PAGE_SIZE]:
            c = edge.get("cursor") if isinstance(edge, dict) else None
            if isinstance(c, str) and 0 < len(c) <= _MAX_CURSOR:
                cursor = c
            try:
                tx = Arweave._parse_node(edge["node"], server)
            except (KeyError, TypeError, ValueError, AttributeError, OverflowError):
                continue  # skip one malformed node, keep the rest
            if tx is not None:
                out.append(tx)
        return out, has_next, cursor

    @staticmethod
    def _parse_node(node: Any, server: str = "") -> ArweaveTx | None:
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
        data = node.get("data")
        size = _as_int(data.get("size")) if isinstance(data, dict) else None  # informational only
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
            server=server,
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

    def fetch(self, tx: ArweaveTx, deadline: float | None = None) -> bytes | None:
        """Download a transaction's data once per tx id, whatever any server CLAIMED about its size
        (REC-M2). The 1024-byte read cap is the only size rule; on a too-large, empty or failed answer the
        next gateway is tried (one gateway cannot suppress the data). Each gateway's timeout is clamped to
        the time left before ``deadline``."""
        if tx.id in self._data:
            return self._data[tx.id]
        data: bytes | None = None
        for gw in self.gateways:
            per_request = self.timeout
            if deadline is not None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    self.truncated = True
                    break
                per_request = max(0.001, min(self.timeout, remaining))
            try:
                got = get_capped(f"{gw}/{tx.id}", timeout=per_request, max_bytes=MAX_BLOB)
            except TooLarge:
                self.warnings.append(
                    f"Arweave gateway {host_of(gw)}: tx {tx.id} larger than {MAX_BLOB} bytes"
                )
                continue
            except NetError as e:
                self.warnings.append(f"Arweave gateway {host_of(gw)} failed ({e})")
                continue
            if got:
                data = got
                break
        if data is None:
            self.truncated = True  # listed but not retrievable anywhere: results may be incomplete
        self._data[tx.id] = data
        return data

    def fetch_all(self, records: Iterable[ArweaveTx]) -> list[tuple[ArweaveTx, bytes]]:
        """Fetch records interleaved across servers (not by claimed height), within MAX_FETCHES distinct
        tx ids and FETCH_DEADLINE seconds. Records of tx ids already downloaded are always kept (they
        cost nothing and count toward support)."""
        by_server: dict[str, list[ArweaveTx]] = {}
        for r in records:
            by_server.setdefault(r.server, []).append(r)
        queues = list(by_server.values())
        order: list[ArweaveTx] = []
        while any(queues):
            for q in queues:
                if q:
                    order.append(q.pop(0))
        deadline = time.monotonic() + FETCH_DEADLINE
        out: list[tuple[ArweaveTx, bytes]] = []
        fetched = 0
        warned = False
        for tx in order:
            if tx.id not in self._data:
                if fetched >= MAX_FETCHES or time.monotonic() > deadline:
                    self.truncated = True
                    if not warned:
                        self.warnings.append(
                            f"Arweave download budget reached ({fetched} transactions); some listed copies "
                            "were not downloaded"
                        )
                        warned = True
                    continue
                fetched += 1
            data = self.fetch(tx, deadline=deadline)
            if data is not None:
                out.append((tx, data))
        return out

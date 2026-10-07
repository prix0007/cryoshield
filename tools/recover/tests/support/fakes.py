"""In-process HTTP fakes for a VaultRegistry JSON-RPC node and an Arweave GraphQL gateway.

They listen on 127.0.0.1 so the real urllib code path is exercised, and they record every request so
tests can assert exactly what left the process.
"""

from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from cryoshield_recover import abi
from cryoshield_recover.keccak import keccak256


def word(n: int) -> bytes:
    return n.to_bytes(32, "big")


def enc_bytes32_array(items: list[bytes]) -> bytes:
    return word(32) + word(len(items)) + b"".join(items)


def enc_vault(owner: str, blob: bytes, version: int) -> bytes:
    pad = (-len(blob)) % 32
    return (
        bytes(12) + bytes.fromhex(owner[2:]) + word(96) + word(version) + word(len(blob)) + blob + bytes(pad)
    )


@dataclass
class Recorded:
    method: str
    path: str
    body: bytes


class FakeServer:
    def __init__(self) -> None:
        self.requests: list[Recorded] = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def _serve(self, method: str) -> None:
                n = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(n) if n else b""
                outer.requests.append(Recorded(method, self.path, body))
                status, headers, payload = outer.handle(method, self.path, body)
                self.send_response(status)
                for k, v in headers.items():
                    self.send_header(k, v)
                if "Content-Length" not in headers:
                    self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def do_GET(self) -> None:  # noqa: N802
                self._serve("GET")

            def do_POST(self) -> None:  # noqa: N802
                self._serve("POST")

            def log_message(self, *args: Any) -> None:
                pass

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        self._thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def handle(self, method: str, path: str, body: bytes) -> tuple[int, dict[str, str], bytes]:
        raise NotImplementedError

    def __enter__(self) -> FakeServer:
        self._thread.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()

    def bodies(self) -> bytes:
        return b"\n".join(r.path.encode() + b" " + r.body for r in self.requests)


OWNER = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8"
# Fakes default to the default testnet (target-op-sepolia).
TEST_CHAIN_ID = 11155420
REGISTRY = "0xb43f58cf17e64b603ae5588a1dd17e96a0849e44"
# A stand-in VaultRegistry v2 address (harden-gas-sponsorship); the fake serves it next to v1.
REGISTRY_V2 = "0x2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b"
# A stand-in future VaultRegistry v3 with v2's ABI (recover-registry-versions), served by the same node.
REGISTRY_V3 = "0x3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c"
V2_PAGE_MAX = 256
V2_GET_VAULTS_MAX = 32


def enc_vaults(items: list[tuple[str, bytes, int]]) -> bytes:
    """ABI-encode ``tuple(address owner, bytes blob, uint32 version)[]`` as the single return value."""
    tails = [enc_vault(o, b, v) for o, b, v in items]
    offsets, pos = [], 32 * len(items)
    for t in tails:
        offsets.append(word(pos))
        pos += len(t)
    return word(32) + word(len(items)) + b"".join(offsets) + b"".join(tails)


@dataclass
class V2Calls:
    pages: list[tuple[bytes, int, int]] = field(default_factory=list)  # (locator, start, count)
    batches: list[int] = field(default_factory=list)  # getVaults sizes
    lengths: int = 0


class FakeChain(FakeServer):
    def __init__(self, chain_id: int = TEST_CHAIN_ID, address: str = REGISTRY) -> None:
        super().__init__()
        self.chain_id = chain_id
        self.address = address
        self.locators: dict[bytes, list[bytes]] = {}
        self.vaults: dict[bytes, tuple[str, bytes, int]] = {}
        self.logs: list[dict[str, Any]] = []
        self.block = 1000
        self.withhold = False
        self.malicious_abi = False
        self.logs_error = False
        # Emulates public-RPC eth_getLogs block-range limits: ranges wider than this are rejected.
        self.max_log_range: int | None = None
        self.range_error_mode = "-32005"  # "http400" | "-32005" | "-32600"
        self.log_ranges: list[int] = []
        self.down = False
        # VaultRegistry v2 on the same node (served only when ``v2_address`` is set).
        self.v2_address: str | None = None
        self.v2_locators: dict[bytes, list[bytes]] = {}
        self.v2_vaults: dict[bytes, tuple[str, bytes, int]] = {}
        self.v2_calls = V2Calls()
        self.v2_length_override: int | None = None  # a lying locatorLength
        self.v2_page_extra = 0  # a lying resolveLocator page: this many extra ids
        self.v2_getvaults_drop = 0  # a lying getVaults: this many entries fewer than asked
        self.v2_getvaults_error = False  # getVaults fails (outage, or an RPC withholding v2)
        self.v2_getvaults_fail_once = 0  # the next N getVaults calls fail transiently
        self.v2_spam_pages = False  # every page is 256 junk ids (a hostile RPC)
        self.v2_delay = 0.0  # seconds to sleep before answering any v2 call (a slow RPC)
        self.v2_grow_after_length = 0  # entries appended between locatorLength and the pages
        self.v2_too_large = False  # every getVaults answer is padded past any response cap
        self.v2_getvaults_malformed_once = 0  # the next N getVaults answers are malformed ABI
        self.call_delay = 0.0  # seconds every eth_call (v1 and v2) hangs; eth_chainId still answers
        # Further v2-ABI registries on this node, by address (a fake v3); each is a state-only FakeChain.
        self.extra: dict[str, FakeChain] = {}

    def add_registry(self, address: str = REGISTRY_V3) -> FakeChain:
        """Serve another v2-ABI registry at ``address`` on this node and return its state, which has the
        v2 helpers (``add_vault_v2``, ``update_vault_v2``) and flags (``v2_delay``, ``logs_error``, …)."""
        reg = FakeChain(self.chain_id)
        reg.httpd.server_close()  # state only: this node answers for it
        reg.enable_v2(address.lower())
        self.extra[address.lower()] = reg
        return reg

    def enable_v2(self, address: str = REGISTRY_V2) -> FakeChain:
        self.v2_address = address
        return self

    def add_vault_v2(
        self, vault_id: bytes, blob: bytes, locators: list[bytes], owner: str = OWNER, *, log: bool = True
    ) -> None:
        assert self.v2_address is not None
        self.v2_vaults[vault_id] = (owner, blob, 1)
        for loc in locators:
            self.v2_locators.setdefault(loc, []).append(vault_id)
        if log:
            self._log(
                abi.TOPIC_VAULT_CREATED,
                vault_id,
                1,
                blob,
                extra_topic=bytes(12) + bytes.fromhex(owner[2:]),
                address=self.v2_address,
            )

    def update_vault_v2(self, vault_id: bytes, blob: bytes) -> None:
        assert self.v2_address is not None
        owner, _, ver = self.v2_vaults[vault_id]
        self.v2_vaults[vault_id] = (owner, blob, ver + 1)
        self._log(abi.TOPIC_VAULT_UPDATED, vault_id, ver + 1, blob, address=self.v2_address)

    def stuff_v2(self, locator: bytes, n: int, tag: int = 0) -> list[bytes]:
        """Append ``n`` junk vaults (each a real vault with an undecodable blob) under ``locator``."""
        ids = [keccak256(b"junk" + tag.to_bytes(4, "big") + i.to_bytes(8, "big")) for i in range(n)]
        for i, vid in enumerate(ids):
            self.add_vault_v2(
                vid, b"junk" + i.to_bytes(4, "big"), [locator], owner="0x" + "44" * 20, log=False
            )
        return ids

    # --- state helpers -------------------------------------------------------
    def add_vault(self, vault_id: bytes, blob: bytes, locators: list[bytes], owner: str = OWNER) -> None:
        self.vaults[vault_id] = (owner, blob, 1)
        for loc in locators:
            self.locators.setdefault(loc, []).append(vault_id)
        self._log(
            abi.TOPIC_VAULT_CREATED, vault_id, 1, blob, extra_topic=bytes(12) + bytes.fromhex(owner[2:])
        )

    def update_vault(self, vault_id: bytes, blob: bytes) -> None:
        owner, _, ver = self.vaults[vault_id]
        self.vaults[vault_id] = (owner, blob, ver + 1)
        self._log(abi.TOPIC_VAULT_UPDATED, vault_id, ver + 1, blob)

    def _log(
        self,
        topic: bytes,
        vault_id: bytes,
        version: int,
        blob: bytes,
        extra_topic: bytes | None = None,
        address: str | None = None,
    ) -> None:
        topics = ["0x" + topic.hex(), "0x" + vault_id.hex()]
        if extra_topic:
            topics.append("0x" + extra_topic.hex())
        self.logs.append(
            {
                "address": address or self.address,
                "topics": topics,
                "data": "0x" + (word(version) + keccak256(blob)).hex(),
                "blockNumber": hex(10 + len(self.logs)),
            }
        )

    # --- JSON-RPC ------------------------------------------------------------
    def handle(self, method: str, path: str, body: bytes) -> tuple[int, dict[str, str], bytes]:
        if self.down:
            return 503, {}, b"down"
        req = json.loads(body)
        if req.get("method") == "eth_getLogs" and self.max_log_range is not None:
            f = req["params"][0]
            width = int(f["toBlock"], 16) - int(f["fromBlock"], 16) + 1
            self.log_ranges.append(width)
            if width > self.max_log_range:
                if self.range_error_mode == "http400":
                    return 400, {"Content-Type": "application/json"}, b'{"error":"block range too large"}'
                code = int(self.range_error_mode)
                err = {"code": code, "message": f"query exceeds max block range {self.max_log_range}"}
                return (
                    200,
                    {"Content-Type": "application/json"},
                    json.dumps({"jsonrpc": "2.0", "id": req["id"], "error": err}).encode(),
                )
        try:
            result = self.rpc(req["method"], req["params"])
            resp: dict[str, Any] = {"jsonrpc": "2.0", "id": req["id"], "result": result}
        except LookupError as e:
            resp = {"jsonrpc": "2.0", "id": req["id"], "error": {"code": -32000, "message": str(e)}}
        return 200, {"Content-Type": "application/json"}, json.dumps(resp).encode()

    def rpc(self, method: str, params: list[Any]) -> Any:
        if method == "eth_chainId":
            return hex(self.chain_id)
        if method == "eth_blockNumber":
            return hex(self.block)
        if method == "eth_call":
            if self.call_delay:
                time.sleep(self.call_delay)
            call = params[0]
            data = bytes.fromhex(call["data"][2:])
            if call["to"].lower() in self.extra:
                return self.extra[call["to"].lower()].rpc(method, params)
            if self.v2_address is not None and call["to"].lower() == self.v2_address:
                return "0x" + self._v2_call(data).hex()
            assert call["to"].lower() == self.address
            sel, arg = data[:4], data[4:36]
            if self.malicious_abi:
                return "0x" + (word(32) + word(10**6)).hex()
            if sel == abi.SEL_RESOLVE_LOCATOR:
                ids = [] if self.withhold else self.locators.get(arg, [])
                return "0x" + enc_bytes32_array(ids).hex()
            if sel == abi.SEL_GET_VAULT:
                owner, blob, ver = self.vaults.get(arg, ("0x" + "00" * 20, b"", 0))
                if self.withhold:
                    owner, blob, ver = ("0x" + "00" * 20, b"", 0)
                return "0x" + enc_vault(owner, blob, ver).hex()
            raise LookupError("execution reverted")
        if method == "eth_getLogs":
            if self.logs_error:
                raise LookupError("internal error")
            f = params[0]
            if f["address"].lower() in self.extra:
                return self.extra[f["address"].lower()].rpc(method, params)
            t0s, vid = f["topics"]
            lo, hi = int(f["fromBlock"], 16), int(f["toBlock"], 16)
            return [
                lg
                for lg in self.logs
                if lg["address"].lower() == f["address"].lower()
                and lg["topics"][0] in t0s
                and lg["topics"][1] == vid
                and lo
                <= int(lg["blockNumber"], 16)
                <= min(hi, self.block)  # a node knows only up to its head
            ]
        raise LookupError(f"method {method} not supported")

    def _v2_call(self, data: bytes) -> bytes:
        """VaultRegistry v2 views (contracts/abi/VaultRegistryV2.json)."""
        sel = data[:4]
        if self.v2_delay:
            time.sleep(self.v2_delay)
        if sel == abi.SEL_LOCATOR_LENGTH:
            self.v2_calls.lengths += 1
            n = len([] if self.withhold else self.v2_locators.get(data[4:36], []))
            if self.v2_grow_after_length:
                self.stuff_v2(data[4:36], self.v2_grow_after_length, tag=99)
                self.v2_grow_after_length = 0
            return word(n if self.v2_length_override is None else self.v2_length_override)
        if sel == abi.SEL_RESOLVE_LOCATOR_PAGE:
            loc = data[4:36]
            start, count = int.from_bytes(data[36:68], "big"), int.from_bytes(data[68:100], "big")
            self.v2_calls.pages.append((loc, start, count))
            if self.v2_spam_pages:
                return enc_bytes32_array(
                    [keccak256(b"spam" + start.to_bytes(32, "big") + bytes([i])) for i in range(256)]
                )
            ids = [] if self.withhold else self.v2_locators.get(loc, [])
            page = ids[start : start + min(count, V2_PAGE_MAX)] if start < len(ids) else []
            if self.v2_page_extra:
                page = page + [keccak256(b"extra" + bytes([i])) for i in range(self.v2_page_extra)]
            return enc_bytes32_array(page)
        if sel == abi.SEL_GET_VAULTS:
            n = int.from_bytes(data[36:68], "big")
            self.v2_calls.batches.append(n)
            if self.v2_getvaults_error:
                raise LookupError("internal error")
            if self.v2_too_large:
                return bytes(200 * 1024)
            if self.v2_getvaults_malformed_once:
                self.v2_getvaults_malformed_once -= 1
                return word(32) + word(n + 1)
            if self.v2_getvaults_fail_once:
                self.v2_getvaults_fail_once -= 1
                raise LookupError("temporary failure")
            if n > V2_GET_VAULTS_MAX:
                raise LookupError("execution reverted: TooManyIds")
            ids = [data[68 + 32 * i : 100 + 32 * i] for i in range(n)]
            empty = ("0x" + "00" * 20, b"", 0)
            items = [empty if self.withhold else self.v2_vaults.get(i, empty) for i in ids]
            return enc_vaults(items[: len(items) - self.v2_getvaults_drop])
        if sel == abi.SEL_GET_VAULT:
            owner, blob, ver = self.v2_vaults.get(data[4:36], ("0x" + "00" * 20, b"", 0))
            return enc_vault(owner, blob, ver)
        raise LookupError("execution reverted")  # v2 has no 1-argument resolveLocator


TXID_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"


def txid(n: int) -> str:
    s = ""
    for _ in range(43):
        s += TXID_ALPHABET[n % 64]
        n //= 64
    return s


@dataclass
class FakeTx:
    data: bytes
    tags: list[tuple[str, str]]
    height: int = 100
    declared_size: int | None = None


@dataclass
class FakeArweave(FakeServer):
    txs: dict[str, FakeTx] = field(default_factory=dict)

    def __post_init__(self) -> None:
        FakeServer.__init__(self)
        self.down = False
        self.graphql_pages = 0

    @property
    def graphql_url(self) -> str:
        return self.url + "/graphql"

    def mirror(
        self,
        blob: bytes,
        *,
        vault_id: bytes,
        locators: list[bytes],
        version: int = 1,
        height: int = 100,
        n: int | None = None,
        declared_size: int | None = None,
        app: str = "CryoShield",
    ) -> str:
        tid = txid(n if n is not None else len(self.txs) + 1)
        tags = [
            ("App-Name", app),
            ("CryoShield-Format", "1"),
            ("CryoShield-Vault-Id", "0x" + vault_id.hex()),
            ("CryoShield-Version", str(version)),
        ]
        tags += [("CryoShield-Locator", "0x" + loc.hex()) for loc in locators]
        self.txs[tid] = FakeTx(blob, tags, height, declared_size)
        return tid

    def handle(self, method: str, path: str, body: bytes) -> tuple[int, dict[str, str], bytes]:
        if self.down:
            return 502, {}, b""
        if method == "POST" and path == "/graphql":
            q = json.loads(body)
            filters = q["variables"]["tags"]
            edges = []
            for tid, tx in self.txs.items():
                names = {}
                for k, v in tx.tags:
                    names.setdefault(k, set()).add(v)
                if all(names.get(f["name"], set()) & set(f["values"]) for f in filters):
                    edges.append(
                        {
                            "node": {
                                "id": tid,
                                "data": {
                                    "size": str(
                                        tx.declared_size if tx.declared_size is not None else len(tx.data)
                                    )
                                },
                                "block": {"height": tx.height},
                                "tags": [{"name": k, "value": v} for k, v in tx.tags],
                            }
                        }
                    )
            # Real Arweave GraphQL semantics: sort by height, `first` page size (max 50 here), opaque
            # `after` cursor, and pageInfo.hasNextPage.
            variables = q["variables"]
            desc = variables.get("sort", "HEIGHT_DESC") != "HEIGHT_ASC"
            edges.sort(key=lambda e: e["node"]["block"]["height"], reverse=desc)
            start = int(variables["after"]) if variables.get("after") else 0
            first = min(int(variables.get("first") or 50), 50)
            page = edges[start : start + first]
            for i, e in enumerate(page):
                e["cursor"] = str(start + i + 1)
            self.graphql_pages += 1
            body_out = {
                "data": {
                    "transactions": {
                        "pageInfo": {"hasNextPage": start + first < len(edges)},
                        "edges": page,
                    }
                }
            }
            return 200, {"Content-Type": "application/json"}, json.dumps(body_out).encode()
        if method == "GET":
            tx = self.txs.get(path.lstrip("/"))
            if tx is None:
                return 404, {}, b""
            return 200, {"Content-Type": "application/octet-stream"}, tx.data
        return 400, {}, b""

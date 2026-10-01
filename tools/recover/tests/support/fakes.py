"""In-process HTTP fakes for a VaultRegistry JSON-RPC node and an Arweave GraphQL gateway.

They listen on 127.0.0.1 so the real urllib code path is exercised, and they record every request so
tests can assert exactly what left the process.
"""

from __future__ import annotations

import json
import threading
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
REGISTRY = "0xb43f58cf17e64b603ae5588a1dd17e96a0849e44"


class FakeChain(FakeServer):
    def __init__(self, chain_id: int = 42161, address: str = REGISTRY) -> None:
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
        self.down = False

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
        self, topic: bytes, vault_id: bytes, version: int, blob: bytes, extra_topic: bytes | None = None
    ) -> None:
        topics = ["0x" + topic.hex(), "0x" + vault_id.hex()]
        if extra_topic:
            topics.append("0x" + extra_topic.hex())
        self.logs.append(
            {
                "address": self.address,
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
            call = params[0]
            assert call["to"].lower() == self.address
            data = bytes.fromhex(call["data"][2:])
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
                raise LookupError("block range too large")
            f = params[0]
            t0s, vid = f["topics"]
            lo, hi = int(f["fromBlock"], 16), int(f["toBlock"], 16)
            return [
                lg
                for lg in self.logs
                if lg["topics"][0] in t0s
                and lg["topics"][1] == vid
                and lo <= int(lg["blockNumber"], 16) <= hi
            ]
        raise LookupError(f"method {method} not supported")


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
            return (
                200,
                {"Content-Type": "application/json"},
                json.dumps({"data": {"transactions": {"edges": edges}}}).encode(),
            )
        if method == "GET":
            tx = self.txs.get(path.lstrip("/"))
            if tx is None:
                return 404, {}, b""
            return 200, {"Content-Type": "application/octet-stream"}, tx.data
        return 400, {}, b""

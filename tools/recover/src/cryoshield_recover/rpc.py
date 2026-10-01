"""Read-only Ethereum JSON-RPC client."""

from __future__ import annotations

import itertools
from typing import Any

from .net import NetError, check_url, host_of, post_json
from .text import sanitize

DEFAULT_TIMEOUT = 10.0
MAX_RESPONSE = 64 * 1024
# Only read methods are ever sent. Anything else is a programming error.
ALLOWED_METHODS = frozenset({"eth_chainId", "eth_call", "eth_getLogs", "eth_blockNumber"})


class RpcError(Exception):
    pass


class JsonRpcClient:
    def __init__(self, url: str, *, timeout: float = DEFAULT_TIMEOUT, max_bytes: int = MAX_RESPONSE) -> None:
        self.url = check_url(url)
        self.host = host_of(url)
        self.timeout = timeout
        self.max_bytes = max_bytes
        self._ids = itertools.count(1)

    def call(self, method: str, params: list[Any]) -> Any:
        if method not in ALLOWED_METHODS:
            raise ValueError(f"method {method} not allowed")
        req_id = next(self._ids)
        try:
            resp = post_json(
                self.url,
                {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params},
                timeout=self.timeout,
                max_bytes=self.max_bytes,
            )
        except NetError as e:
            raise RpcError(str(e)) from None
        if not isinstance(resp, dict):
            raise RpcError(f"malformed response from {self.host}")
        if resp.get("error") is not None:
            err = resp["error"]
            msg = err.get("message") if isinstance(err, dict) else None
            text = sanitize(" ".join(msg.split()), 120) if isinstance(msg, str) else "error"  # one line only
            raise RpcError(f"{self.host}: {text}")
        if "result" not in resp:
            raise RpcError(f"malformed response from {self.host}")
        return resp["result"]


def hex_to_bytes(value: Any, *, max_len: int) -> bytes:
    if not isinstance(value, str) or not value.startswith("0x") or len(value) > 2 + 2 * max_len:
        raise RpcError("expected 0x-hex string")
    try:
        return bytes.fromhex(value[2:])
    except ValueError:
        raise RpcError("bad hex") from None


def hex_to_int(value: Any) -> int:
    if not isinstance(value, str) or not value.startswith("0x") or len(value) > 66:
        raise RpcError("expected 0x-hex quantity")
    try:
        return int(value, 16)
    except ValueError:
        raise RpcError("bad quantity") from None

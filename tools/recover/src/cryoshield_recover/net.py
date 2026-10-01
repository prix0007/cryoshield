"""Tiny standard-library HTTP layer with hard limits.

Every endpoint is untrusted. Requests never follow redirects, time out, and stop reading after a
fixed number of bytes. Plain HTTP is allowed only for loopback hosts (a local node); everything else
must be HTTPS with normal certificate verification.
"""

from __future__ import annotations

import http.client
import json
import math
import time
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urlparse

from . import __version__

USER_AGENT = f"cryoshield-recover/{__version__}"
_LOOPBACK = {"localhost", "127.0.0.1", "::1"}


class NetError(Exception):
    """Transport-level failure (unreachable, timeout, HTTP error, redirect, bad JSON)."""


class TooLarge(NetError):
    pass


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        raise NetError(f"refusing redirect ({code})")


_OPENER = urllib.request.build_opener(_NoRedirect())


def check_url(url: str) -> str:
    """Validate an endpoint URL; raise ``ValueError`` with a user-readable reason."""
    p = urlparse(url)
    if p.scheme not in ("https", "http") or not p.hostname:
        raise ValueError(f"not an http(s) URL: {url}")
    if p.scheme == "http" and p.hostname not in _LOOPBACK:
        raise ValueError(f"plain http is only allowed for localhost: {url}")
    if p.username or p.password:
        raise ValueError("credentials in URLs are not allowed")
    return url.rstrip("/")


def host_of(url: str) -> str:
    return urlparse(url).netloc


def _read_capped(resp: Any, max_bytes: int, deadline: float) -> bytes:
    """Read at most ``max_bytes`` before ``deadline`` (monotonic). A trickling server cannot stall us:
    the per-read socket timeout bounds each chunk, and the deadline bounds the whole response."""
    buf = bytearray()
    while True:
        if time.monotonic() > deadline:
            raise NetError("deadline exceeded while reading response")
        chunk: bytes = resp.read1(min(16384, max_bytes + 1 - len(buf)))
        if not chunk:
            return bytes(buf)
        buf += chunk
        if len(buf) > max_bytes:
            raise TooLarge(f"response larger than {max_bytes} bytes")


def request(
    url: str, body: bytes | None, *, timeout: float, max_bytes: int, content_type: str | None = None
) -> bytes:
    headers = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    if content_type:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(check_url(url), data=body, headers=headers, method="POST" if body else "GET")
    deadline = time.monotonic() + 2 * timeout  # whole request: connect + headers + body
    try:
        with _OPENER.open(req, timeout=timeout) as resp:
            length = resp.headers.get("Content-Length")
            if length is not None and length.isdigit() and int(length) > max_bytes:
                raise TooLarge(f"response larger than {max_bytes} bytes")
            return _read_capped(resp, max_bytes, deadline)
    except NetError:
        raise
    except urllib.error.HTTPError as e:
        raise NetError(f"HTTP {e.code} from {host_of(url)}") from None
    except (urllib.error.URLError, OSError, ValueError, http.client.HTTPException) as e:
        raise NetError(f"{host_of(url)} unreachable: {type(e).__name__}") from None


def post_json(url: str, payload: Any, *, timeout: float, max_bytes: int) -> Any:
    raw = request(
        url,
        json.dumps(payload).encode(),
        timeout=timeout,
        max_bytes=max_bytes,
        content_type="application/json",
    )
    return loads_untrusted(raw, host_of(url))


def _reject_constant(name: str) -> Any:
    raise ValueError(f"non-finite number {name}")


def _finite_float(text: str) -> float:
    value = float(text)
    if not math.isfinite(value):
        raise ValueError("non-finite number")
    return value


def loads_untrusted(raw: bytes, source: str) -> Any:
    """json.loads for hostile input: every parse failure becomes NetError.

    Covers ValueError (incl. UnicodeDecodeError, int digit limits), RecursionError (deep nesting fits in
    a few KB), OverflowError, and non-finite numbers (NaN/Infinity/1e999), which are rejected outright.
    """
    try:
        return json.loads(raw, parse_constant=_reject_constant, parse_float=_finite_float)
    except (ValueError, RecursionError, OverflowError, TypeError, MemoryError):
        raise NetError(f"malformed JSON from {source}") from None


def get_capped(url: str, *, timeout: float, max_bytes: int) -> bytes:
    return request(url, None, timeout=timeout, max_bytes=max_bytes)

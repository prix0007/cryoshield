"""A software CTAP2 authenticator (PIN protocol 1 + hmac-secret) for tests.

It plugs in *below* the real python-fido2 ``Fido2Client`` as a ``CtapDevice``, so the real client
code performs PIN key agreement, salt encryption and response decryption. Instead of computing
HMAC(CredRandom, salt) it returns the test vector's PRF output for a credential, but only when it
receives exactly the expected CTAP salt; any other salt yields an unrelated value. Every salt it
receives is recorded, so tests can assert what python-fido2 actually sent.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import struct
from dataclasses import dataclass, field
from typing import Any

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from fido2 import cbor
from fido2.ctap import CtapDevice
from fido2.hid import CAPABILITY, CTAPHID

OK = 0x00
ERR_INVALID_PARAMETER = 0x02
ERR_NO_CREDENTIALS = 0x2E
ERR_NOT_ALLOWED = 0x30
ERR_PIN_INVALID = 0x31
ERR_PIN_BLOCKED = 0x32
ERR_PIN_AUTH_INVALID = 0x33


def _aes_cbc(key: bytes, data: bytes, encrypt: bool) -> bytes:
    c = Cipher(algorithms.AES(key), modes.CBC(b"\x00" * 16))
    op = c.encryptor() if encrypt else c.decryptor()
    return op.update(data) + op.finalize()


def _auth(key: bytes, msg: bytes) -> bytes:
    return hmac.new(key, msg, hashlib.sha256).digest()[:16]


@dataclass
class SoftCred:
    rp_id: str
    cred_id: bytes
    prf: bytes  # what hmac-secret returns for the expected salt
    discoverable: bool = True


@dataclass
class SoftAuthenticator(CtapDevice):
    creds: list[SoftCred]
    expected_salt: bytes
    pin: str = "246813"
    retries: int = 8
    report_uv: bool = True
    seen_salts: list[bytes] = field(default_factory=list)
    commands: list[int] = field(default_factory=list)

    def __post_init__(self) -> None:
        self._ka = ec.generate_private_key(ec.SECP256R1())
        self._pin_token = os.urandom(32)
        self._pending: list[dict[int, Any]] = []
        self._wrong_salt_secret = os.urandom(32)

    # ------------------------------------------------------------------ CtapDevice
    @property
    def capabilities(self) -> int:
        return int(CAPABILITY.CBOR)

    def call(self, cmd: int, data: bytes = b"", event: Any = None, on_keepalive: Any = None) -> bytes:
        assert cmd == CTAPHID.CBOR
        op = data[0]
        args = cbor.decode(data[1:]) if len(data) > 1 else {}
        self.commands.append(op)
        handler = {
            0x04: self._info,
            0x06: self._client_pin,
            0x02: self._get_assertion,
            0x08: self._next_assertion,
            0x0B: self._selection,
        }.get(op)
        if handler is None:
            return bytes([0x01])
        status, resp = handler(args)
        return bytes([status]) + (cbor.encode(resp) if resp is not None else b"")

    def close(self) -> None:
        pass

    @classmethod
    def list_devices(cls) -> Any:  # pragma: no cover - not used
        return iter(())

    # ------------------------------------------------------------------ commands
    def _info(self, _a: Any) -> tuple[int, Any]:
        return OK, {
            1: ["FIDO_2_0"],
            2: ["hmac-secret"],
            3: b"\x00" * 16,
            4: {"rk": True, "up": True, "clientPin": True},
            6: [1],
        }

    def _cose(self) -> dict[int, Any]:
        n = self._ka.public_key().public_numbers()
        return {1: 2, 3: -25, -1: 1, -2: n.x.to_bytes(32, "big"), -3: n.y.to_bytes(32, "big")}

    def _shared(self, peer: dict[int, Any]) -> bytes:
        pub = ec.EllipticCurvePublicNumbers(
            int.from_bytes(peer[-2], "big"), int.from_bytes(peer[-3], "big"), ec.SECP256R1()
        ).public_key()
        return hashlib.sha256(self._ka.exchange(ec.ECDH(), pub)).digest()

    def _client_pin(self, a: dict[int, Any]) -> tuple[int, Any]:
        sub = a[2]
        if sub == 0x01:
            return OK, {3: self.retries}
        if sub == 0x02:
            return OK, {1: self._cose()}
        if sub == 0x05:
            if self.retries <= 0:
                return ERR_PIN_BLOCKED, None
            shared = self._shared(a[3])
            if _aes_cbc(shared, a[6], False) != hashlib.sha256(self.pin.encode()).digest()[:16]:
                self.retries -= 1
                return (ERR_PIN_BLOCKED if self.retries == 0 else ERR_PIN_INVALID), None
            self.retries = 8
            return OK, {2: _aes_cbc(shared, self._pin_token, True)}
        return ERR_INVALID_PARAMETER, None

    def _selection(self, _a: Any) -> tuple[int, Any]:
        return OK, None

    def _get_assertion(self, a: dict[int, Any]) -> tuple[int, Any]:
        rp_id, cdh = a[1], a[2]
        allow = [d["id"] for d in a.get(3) or []]
        exts = a.get(4) or {}
        opts = a.get(5) or {}
        uv = False
        if a.get(6) is not None:
            if a.get(7) != 1 or not hmac.compare_digest(a[6], _auth(self._pin_token, cdh)):
                return ERR_PIN_AUTH_INVALID, None
            uv = True
        matches = [
            c for c in self.creds if c.rp_id == rp_id and (c.cred_id in allow if allow else c.discoverable)
        ]
        if not matches:
            return ERR_NO_CREDENTIALS, None
        up = opts.get("up", True)
        responses = []
        for c in matches:
            flags = (0x01 if up else 0) | (0x04 if uv and self.report_uv else 0)
            ext_out = b""
            hs = exts.get("hmac-secret")
            if hs is not None:
                shared = self._shared(hs[1])
                if not hmac.compare_digest(_auth(shared, hs[2]), hs[3]):
                    return ERR_INVALID_PARAMETER, None
                salt = _aes_cbc(shared, hs[2], False)
                self.seen_salts.append(salt)
                if not uv:
                    # CredRandomWithoutUV: a different secret entirely
                    out = hmac.new(b"without-uv" + c.cred_id, salt, hashlib.sha256).digest()
                elif salt[:32] == self.expected_salt:
                    out = c.prf
                else:
                    out = hmac.new(self._wrong_salt_secret, salt, hashlib.sha256).digest()
                ext_out = cbor.encode({"hmac-secret": _aes_cbc(shared, out, True)})
                flags |= 0x80
            auth_data = (
                hashlib.sha256(rp_id.encode()).digest() + bytes([flags]) + struct.pack(">I", 7) + ext_out
            )
            resp: dict[int, Any] = {1: {"type": "public-key", "id": c.cred_id}, 2: auth_data, 3: b"\x30" * 70}
            if not allow:
                resp[4] = {"id": hashlib.sha256(c.cred_id).digest()[:16]}
            responses.append(resp)
        if len(responses) > 1:
            responses[0][5] = len(responses)
        self._pending = responses[1:]
        return OK, responses[0]

    def _next_assertion(self, _a: Any) -> tuple[int, Any]:
        if not self._pending:
            return ERR_NOT_ALLOWED, None
        return OK, self._pending.pop(0)

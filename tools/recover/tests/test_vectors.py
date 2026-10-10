"""Every case in packages/vault-crypto/test-vectors/v1.json (task 2.2).

Read-side sections (derivations, vaults, decodeCases, openCases, selectCases) exercise the shipped
recovery code. Write-side sections (createCases, addKeyCases, updatePayloadCases) are checked with a
test-only writer (tests/support/writer.py) built on the same shipped primitives, so the independent
implementation is cross-checked byte for byte in both directions. The tool itself never writes vaults.
"""

from __future__ import annotations

import hashlib
from typing import Any

import pytest
from support import vectors, writer
from support.vectors import h

from cryoshield_recover import derive, shamir
from cryoshield_recover.authdata import UV_FLAG, require_user_verified
from cryoshield_recover.errors import VaultError
from cryoshield_recover.format import decode_blob, max_payload_bytes, payload_aad, wrap_aad
from cryoshield_recover.vault import UnlockKey, open_vault, select_vault, validate_vault_id

C = vectors.load()["constants"]


def keys_of(raw: list[dict[str, Any]]) -> list[UnlockKey]:
    return [
        UnlockKey(prf=bytearray(h(k["prf"])), cred_id=h(k["credId"]) if k.get("credId") else None)
        for k in raw
    ]


# ------------------------------------------------------------------ constants / derivations
def test_constants() -> None:
    assert derive.LOCATOR_SALT_INPUT == C["locatorSaltInput"].encode()
    assert derive.locator_salt() == h(C["locatorSalt"])
    assert derive.ctap_salt() == h(C["ctapSalt"])
    assert derive.INFO_LOCATOR == C["infoLocator"].encode()
    assert derive.INFO_WRAP == C["infoWrap"].encode()


@pytest.mark.parametrize("case", vectors.cases("derivations"), ids=vectors.ids("derivations"))
def test_derivation(case: dict[str, Any]) -> None:
    prf = bytearray(h(case["prf"]))
    assert h(case["prfInput"]) == derive.locator_salt()
    assert h(case["ctapSalt"]) == derive.ctap_salt()
    assert derive.derive_locator(prf) == h(case["locator"])
    assert bytes(derive.derive_wrap_key(prf, h(case["wrapSalt"]))) == h(case["wrapKey"])
    assert prf == bytearray(h(case["prf"])), "derivation helpers must not wipe their input"


# ------------------------------------------------------------------ positive vaults
@pytest.mark.parametrize("v", vectors.cases("vaults"), ids=vectors.ids("vaults"))
def test_vault_components(v: dict[str, Any]) -> None:
    blob = h(v["blob"])
    assert len(blob) == v["blobLength"]
    d = decode_blob(blob)
    assert d.mode == v["mode"] and d.threshold == v["threshold"] and d.rp_id == v["rpId"]
    assert d.wrap_salt == h(v["wrapSalt"])
    assert d.payload_nonce == h(v["payloadNonce"])
    vid = h(v["vaultId"])
    assert payload_aad(d, vid) == h(v["payloadAad"])
    assert h(v["payloadAad"]).endswith(vid)
    assert max_payload_bytes(d.rp_id, [e.cred_id for e in d.entries], d.mode) == v["maxPayloadBytes"]
    for i, cred in enumerate(v["credentials"]):
        e = d.entries[i]
        assert e.cred_id == h(cred["id"])
        assert e.wrap_nonce == h(cred["wrapNonce"])
        assert e.wrapped == h(cred["wrapped"])
        assert wrap_aad(d, i, vid) == h(cred["wrapAad"])
        assert vid in h(cred["wrapAad"])
        prf = bytearray(h(cred["prf"]))
        assert derive.derive_locator(prf) == h(cred["locator"])
        assert bytes(derive.derive_wrap_key(prf, d.wrap_salt)) == h(cred["wrapKey"])


@pytest.mark.parametrize("v", vectors.cases("vaults"), ids=vectors.ids("vaults"))
def test_vault_opens_with_each_key(v: dict[str, Any]) -> None:
    creds = v["credentials"]
    vid = h(v["vaultId"])
    if v["mode"] == 1:
        for cred in creds:
            key = [UnlockKey(bytearray(h(cred["prf"])))]
            assert bytes(open_vault(h(v["blob"]), key, vid)) == h(v["secret"])
    else:
        m = v["threshold"]
        keys = [UnlockKey(bytearray(h(c["prf"]))) for c in creds[:m]]
        assert bytes(open_vault(h(v["blob"]), keys, vid)) == h(v["secret"])


@pytest.mark.parametrize("v", vectors.cases("vaults"), ids=vectors.ids("vaults"))
def test_vault_recreated_byte_for_byte(v: dict[str, Any]) -> None:
    blob = writer.create_from_vector(v)
    assert blob.hex() == v["blob"]


def test_shamir_shares_and_combine() -> None:
    v = next(x for x in vectors.cases("vaults") if x["mode"] == 2)
    shares = v["shamir"]["shares"]
    data_key = h(v["dataKey"])
    for s in shares:
        assert h(s["wrapPlaintext"]) == bytes([s["x"]]) + h(s["y"])
    for i in range(len(shares)):
        for j in range(len(shares)):
            if i != j:
                pts = [(shares[i]["x"], h(shares[i]["y"])), (shares[j]["x"], h(shares[j]["y"]))]
                assert bytes(shamir.combine(pts)) == data_key
    # Independent split check: coefficients from shamirRng after the 255 shuffle bytes.
    assert writer.shamir_split_from_vector(v) == [(s["x"], h(s["y"])) for s in shares]


# ------------------------------------------------------------------ decode cases
@pytest.mark.parametrize("case", vectors.cases("decodeCases"), ids=vectors.ids("decodeCases"))
def test_decode_case(case: dict[str, Any]) -> None:
    blob = h(case["blob"])
    if "expectedError" in case:
        with pytest.raises(VaultError) as ei:
            decode_blob(blob)
        assert ei.value.code == case["expectedError"]
        return
    exp = case["expected"]
    d = decode_blob(blob)
    assert d.mode == exp["mode"]
    assert d.threshold == exp["threshold"]
    assert d.rp_id == exp["rpId"]
    assert d.wrap_salt == h(exp["wrapSalt"])
    assert [e.cred_id.hex() for e in d.entries] == exp["credIds"]
    assert d.header_length == exp["headerLength"]
    assert d.payload_offset == exp["payloadOffset"]


# ------------------------------------------------------------------ open cases
@pytest.mark.parametrize("case", vectors.cases("openCases"), ids=vectors.ids("openCases"))
def test_open_case(case: dict[str, Any]) -> None:
    keys = keys_of(case["keys"])
    if "expectedError" in case:
        with pytest.raises(VaultError) as ei:
            open_vault(h(case["blob"]), keys, h(case["vaultId"]))
        assert ei.value.code == case["expectedError"]
        assert str(ei.value) == case["expectedError"], "errors must carry no detail beyond the code"
    else:
        assert bytes(open_vault(h(case["blob"]), keys, h(case["vaultId"]))) == h(case["expectedSecret"])
    for k in keys:
        assert k.prf == bytearray(len(k.prf)), "caller PRF buffers must be wiped on return"


# ------------------------------------------------------------------ select cases
@pytest.mark.parametrize("case", vectors.cases("selectCases"), ids=vectors.ids("selectCases"))
def test_select_case(case: dict[str, Any]) -> None:
    cands = [(h(c["vaultId"]), h(c["blob"])) for c in case["candidates"]]
    prf = bytearray(h(case["prf"]))
    if "expectedError" in case:
        with pytest.raises(VaultError) as ei:
            select_vault(cands, prf)
        assert ei.value.code == case["expectedError"]
    else:
        index, vid, secret = select_vault(cands, prf)
        assert index == case["expectedIndex"]
        assert vid == h(case["expectedVaultId"])
        assert bytes(secret) == h(case["expectedSecret"])
    assert prf == bytearray(32)


# ------------------------------------------------------------------ write-side cases (test-only writer)
@pytest.mark.parametrize("case", vectors.cases("createCases"), ids=vectors.ids("createCases"))
def test_create_case(case: dict[str, Any]) -> None:
    with pytest.raises(VaultError) as ei:
        writer.create(
            vault_id=h(case["vaultId"]),
            rp_id=case["rpId"],
            credentials=[(h(c["id"]), bytearray(h(c["prf"]))) for c in case["credentials"]],
            secret=h(case["secret"]),
            mode=case["mode"],
            threshold=case["threshold"],
            rng=writer.ExhaustedRng(),
        )
    assert ei.value.code == case["expectedError"]
    if "maxPayloadBytes" in case:
        assert ei.value.max_payload_bytes == case["maxPayloadBytes"]
        assert str(case["maxPayloadBytes"]) in ei.value.detail


@pytest.mark.parametrize("case", vectors.cases("addKeyCases"), ids=vectors.ids("addKeyCases"))
def test_add_key_case(case: dict[str, Any]) -> None:
    key = keys_of([case["key"]])[0]
    new = case["newCredential"]
    run = lambda: writer.add_key(  # noqa: E731
        h(case["blob"]),
        key,
        h(case["vaultId"]),
        h(new["id"]),
        bytearray(h(new["prf"])),
        writer.FixedRng(h(case["rng"])),
    )
    if "expectedError" in case:
        with pytest.raises(VaultError) as ei:
            run()
        assert ei.value.code == case["expectedError"]
        return
    blob = run()
    assert blob.hex() == case["expectedBlob"]
    assert len(blob) == case["expectedBlobLength"]
    assert derive.derive_locator(bytearray(h(new["prf"]))) == h(new["locator"])
    # The new key alone opens the result.
    assert open_vault(blob, [UnlockKey(bytearray(h(new["prf"])))], h(case["vaultId"]))


@pytest.mark.parametrize("case", vectors.cases("updatePayloadCases"), ids=vectors.ids("updatePayloadCases"))
def test_update_payload_case(case: dict[str, Any]) -> None:
    keys = keys_of(case["keys"])
    run = lambda: writer.update_payload(  # noqa: E731
        h(case["blob"]), keys, h(case["vaultId"]), h(case["newSecret"]), writer.FixedRng(h(case["rng"]))
    )
    if "expectedError" in case:
        with pytest.raises(VaultError) as ei:
            run()
        assert ei.value.code == case["expectedError"]
        if "maxPayloadBytes" in case:
            assert ei.value.max_payload_bytes == case["maxPayloadBytes"]
        return
    assert run().hex() == case["expectedBlob"]


# ------------------------------------------------------------------ authenticator data (UV flag, §3.1)
def test_uv_flag_constant() -> None:
    assert UV_FLAG == C["uvFlagMask"]


@pytest.mark.parametrize(
    "case", vectors.cases("authenticatorDataCases"), ids=vectors.ids("authenticatorDataCases")
)
def test_authenticator_data_case(case: dict[str, Any]) -> None:
    data = h(case["authenticatorData"])
    if case["expectedError"]:
        with pytest.raises(VaultError) as ei:
            require_user_verified(data)
        assert ei.value.code == case["expectedError"]
    else:
        require_user_verified(data)


# ------------------------------------------------------------------ vaultId binding (§4.1)
@pytest.mark.parametrize(
    "bad", [b"", b"\x01" * 31, b"\x01" * 33, b"\x00" * 32], ids=["empty", "31", "33", "zero"]
)
def test_invalid_vault_id(bad: bytes) -> None:
    with pytest.raises(VaultError) as ei:
        validate_vault_id(bad)
    assert ei.value.code == "INVALID_ARGUMENT"


def test_every_vault_vector_is_bound_to_its_vault_id() -> None:
    for v in vectors.cases("vaults"):
        keys = [UnlockKey(bytearray(h(c["prf"]))) for c in v["credentials"]]
        other = bytes(b ^ 0x5A for b in h(v["vaultId"]))
        with pytest.raises(VaultError) as ei:
            open_vault(h(v["blob"]), keys, other)
        assert ei.value.code == "NO_MATCHING_KEY"


# ------------------------------------------------------------------ pad-to-max-payload
@pytest.mark.parametrize("v", vectors.cases("vaults"), ids=vectors.ids("vaults"))
def test_vault_padded_to_maximum(v: dict[str, Any]) -> None:
    d = decode_blob(h(v["blob"]))
    assert v["paddedLength"] == v["maxPayloadBytes"] + 2
    assert len(d.payload_ct) == v["paddedLength"] + 16
    assert writer.padded_length_for(d.rp_id, [e.cred_id for e in d.entries], d.mode) == v["paddedLength"]


@pytest.mark.parametrize("g", vectors.cases("lengthHidingCases"), ids=vectors.ids("lengthHidingCases"))
def test_length_hiding_group(g: dict[str, Any]) -> None:
    by_name = {v["name"]: v for v in vectors.cases("vaults")}
    assert g["paddedLength"] == 64 * ((1024 - g["overhead"]) // 64)
    assert g["blobLength"] == g["overhead"] + g["paddedLength"]
    assert any(n.endswith("12-word") for n in g["vaults"])
    for name in g["vaults"]:
        assert len(h(by_name[name]["blob"])) == g["blobLength"], name


@pytest.mark.parametrize("case", vectors.cases("legacyPaddingCases"), ids=vectors.ids("legacyPaddingCases"))
def test_legacy_padding_case(case: dict[str, Any]) -> None:
    """Blobs padded in 64-byte steps (every OP Sepolia vault before pad-to-max-payload) still open."""
    blob = h(case["blob"])
    assert len(blob) == case["blobLength"]
    assert hashlib.sha256(blob).hexdigest() == case["sha256"]
    keys = keys_of(case["keys"])
    assert bytes(open_vault(blob, keys, h(case["vaultId"]))) == h(case["expectedSecret"])


def test_legacy_and_padding_sections_present() -> None:
    assert len(vectors.cases("legacyPaddingCases")) >= 6
    names = {c["name"] for c in vectors.cases("openCases")}
    assert {"nonzero-pad-byte", "length-prefix-overrun"} <= names

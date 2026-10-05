"""VaultRegistry v2 reads (OpenSpec change harden-gas-sponsorship, task 3.6).

Readers query v2 then v1 and treat the candidates as one list (vault-registry spec, "Registry versions
coexist"); v2 locators have no cap, so ``resolveLocator`` is paged (at most 256 per page) under one
overall deadline, and candidate blobs are read with ``getVaults`` in batches of at most 32.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from support import vectors
from support.fakes import (
    REGISTRY_V2,
    V2_GET_VAULTS_MAX,
    V2_PAGE_MAX,
    FakeArweave,
    FakeChain,
    enc_vault,
    enc_vaults,
    word,
)
from support.keys import BY_NAME, FakePrfSource, PhysicalKey
from support.vectors import REPO_ROOT, h
from test_recover import RecUI, cfg_for

from cryoshield_recover import abi
from cryoshield_recover import chain as chain_mod
from cryoshield_recover.candidates import Freshness
from cryoshield_recover.chain import Registries
from cryoshield_recover.config import PLACEHOLDER_ADDRESS, Config
from cryoshield_recover.errors import ExitCode, RecoveryError
from cryoshield_recover.keccak import keccak256
from cryoshield_recover.recover import Recovery

V2V = {v["name"]: v for v in vectors.cases("vaults")}["any-of-2"]
BLOB = h(V2V["blob"])
VID = h(V2V["vaultId"])
SECRET = h(V2V["secret"])
UPDATE = vectors.cases("updatePayloadCases")[0]  # key B replaces the any-of-2 secret
LOC_A, LOC_B = h(BY_NAME["A"]["locator"]), h(BY_NAME["B"]["locator"])
ABI_V2 = REPO_ROOT / "contracts" / "abi" / "VaultRegistryV2.json"


def cfg_v2(chain: FakeChain, *, v1: bool = True, ar: FakeArweave | None = None, **kw: Any) -> Config:
    c = cfg_for(chain, ar, **kw)
    c.registry_v2 = REGISTRY_V2
    c.deploy_block_v2 = 0
    if not v1:
        c.registry = PLACEHOLDER_ADDRESS
    return c


def run(cfg: Config, ui: RecUI | None = None) -> Any:
    ui = ui or RecUI()
    prf = FakePrfSource([PhysicalKey.named("A")], ui=ui)
    return Recovery(cfg, prf, ui).run()


def registries(*chains: FakeChain, v1: bool = True) -> Registries:
    urls = [c.url for c in chains]
    return Registries.build(
        urls,
        chains[0].chain_id,
        v2=(REGISTRY_V2, 0),
        v1=(chains[0].address, 0) if v1 else None,
    )


# ------------------------------------------------------------------ ABI
def test_v2_selectors() -> None:
    assert abi.SEL_LOCATOR_LENGTH == keccak256(b"locatorLength(bytes32)")[:4]
    assert abi.SEL_RESOLVE_LOCATOR_PAGE == keccak256(b"resolveLocator(bytes32,uint256,uint256)")[:4]
    assert abi.SEL_GET_VAULTS == keccak256(b"getVaults(bytes32[])")[:4]
    assert abi.V2_PAGE_SIZE == V2_PAGE_MAX == 256
    assert abi.V2_MAX_IDS_PER_CALL == V2_GET_VAULTS_MAX == 32


@pytest.mark.skipif(not ABI_V2.exists(), reason="contracts/abi/VaultRegistryV2.json not in this checkout yet")
def test_v2_selectors_match_exported_abi() -> None:
    """The hand-written codec must match the ABI the contracts export (never edited here)."""
    items = {x["name"]: x for x in json.loads(ABI_V2.read_text()) if x["type"] in ("function", "event")}

    def sig(name: str) -> bytes:
        ins = ",".join(i["type"] for i in items[name]["inputs"])
        return keccak256(f"{name}({ins})".encode())

    assert sig("locatorLength")[:4] == abi.SEL_LOCATOR_LENGTH
    assert sig("resolveLocator")[:4] == abi.SEL_RESOLVE_LOCATOR_PAGE
    assert sig("getVaults")[:4] == abi.SEL_GET_VAULTS
    assert sig("getVault")[:4] == abi.SEL_GET_VAULT
    assert sig("VaultCreated") == abi.TOPIC_VAULT_CREATED
    assert sig("VaultUpdated") == abi.TOPIC_VAULT_UPDATED
    out = items["getVaults"]["outputs"][0]
    assert out["type"] == "tuple[]"
    assert [c["type"] for c in out["components"]] == ["address", "bytes", "uint32"]


def test_encode_page_and_batch() -> None:
    loc = b"\x07" * 32
    assert abi.encode_resolve_page(loc, 512, 256) == (
        abi.SEL_RESOLVE_LOCATOR_PAGE + loc + word(512) + word(256)
    )
    ids = [b"\x01" * 32, b"\x02" * 32]
    assert abi.encode_get_vaults(ids) == abi.SEL_GET_VAULTS + word(32) + word(2) + b"".join(ids)
    with pytest.raises(ValueError):
        abi.encode_get_vaults([b"\x01" * 32] * 33)


def test_decode_vaults_roundtrip() -> None:
    items = [("0x" + "11" * 20, b"abc", 1), ("0x" + "00" * 20, b"", 0), ("0x" + "22" * 20, b"x" * 1024, 7)]
    assert abi.decode_vaults(enc_vaults(items), 3) == items


@pytest.mark.parametrize(
    "data",
    [
        enc_vaults([("0x" + "11" * 20, b"abc", 1)]),  # wrong count (expected 2)
        enc_vaults([("0x" + "11" * 20, b"abc", 1)] * 2)[:-40],  # truncated
        word(32) + word(2) + word(10**6) + word(64),  # offset past the end
        word(32) + word(2**40),  # absurd length
    ],
)
def test_decode_vaults_rejects_hostile(data: bytes) -> None:
    with pytest.raises(abi.AbiError):
        abi.decode_vaults(data, 2)


def test_decode_vaults_rejects_oversized_blob_and_dirty_address() -> None:
    with pytest.raises(abi.AbiError):
        abi.decode_vaults(enc_vaults([("0x" + "11" * 20, b"x" * 1025, 1)]), 1)
    dirty = bytearray(enc_vaults([("0x" + "11" * 20, b"x", 1)]))
    dirty[32 * 3] = 1  # high byte of the owner word
    with pytest.raises(abi.AbiError):
        abi.decode_vaults(bytes(dirty), 1)


def test_page_decode_allows_256_not_257() -> None:
    from support.fakes import enc_bytes32_array

    assert len(abi.decode_bytes32_array(enc_bytes32_array([b"\x01" * 32] * 256), max_entries=256)) == 256
    with pytest.raises(abi.AbiError):
        abi.decode_bytes32_array(enc_bytes32_array([b"\x01" * 32] * 257), max_entries=256)
    with pytest.raises(abi.AbiError):  # v1 keeps its 16-entry bound
        abi.decode_bytes32_array(enc_bytes32_array([b"\x01" * 32] * 17))


def test_uint_decode() -> None:
    assert abi.decode_uint256(word(5)) == 5
    with pytest.raises(abi.AbiError):
        abi.decode_uint256(b"\x00" * 31)


# ------------------------------------------------------------------ registry reads
def test_v2_then_v1_one_candidate_list() -> None:
    """Both registries are read; v2 ids come first; candidates from both form one list."""
    v1_only = b"\x05" * 32
    with FakeChain() as c:
        c.enable_v2()
        c.add_vault_v2(VID, BLOB, [LOC_A, LOC_B])
        c.add_vault(v1_only, b"v1 blob", [LOC_A])
        reg = registries(c)
        ids = reg.resolve([LOC_A, LOC_B])
        assert ids == [VID, v1_only]
        cands = reg.fetch(ids)
    by_id = {x.vault_id: x for x in cands}
    assert by_id[VID].blob == BLOB and by_id[v1_only].blob == b"v1 blob"
    assert all(x.freshness is Freshness.CURRENT for x in cands)
    assert "v2" in by_id[VID].origin and "v1" in by_id[v1_only].origin


def test_v2_vault_recovers_end_to_end() -> None:
    with FakeChain() as c:
        c.enable_v2()
        c.add_vault_v2(VID, BLOB, [LOC_A, LOC_B])
        res = run(cfg_v2(c))
    assert bytes(res.secret) == SECRET and res.candidate.vault_id == VID


def test_v2_only_without_v1_record() -> None:
    """A chain without v1 (OP Mainnet): only v2 is read; the v1 address is never called."""
    with FakeChain() as c:
        c.enable_v2()
        c.add_vault_v2(VID, BLOB, [LOC_A, LOC_B])
        res = run(cfg_v2(c, v1=False))
        calls = [json.loads(r.body) for r in c.requests]
    assert bytes(res.secret) == SECRET
    targets = {x["params"][0]["to"].lower() for x in calls if x["method"] == "eth_call"}
    assert targets == {REGISTRY_V2}


def test_v1_only_vault_still_recovers_with_both_configured() -> None:
    with FakeChain() as c:
        c.enable_v2()
        c.add_vault(VID, BLOB, [LOC_A, LOC_B])
        res = run(cfg_v2(c))
    assert bytes(res.secret) == SECRET


def test_v1_only_config_never_calls_v2() -> None:
    """Today's presets (no v2 deployment yet) behave exactly as before."""
    with FakeChain() as c:
        c.add_vault(VID, BLOB, [LOC_A, LOC_B])
        res = run(cfg_for(c))
    assert bytes(res.secret) == SECRET


def test_vault_id_mode_reads_both_registries() -> None:
    with FakeChain() as c:
        c.enable_v2()
        c.add_vault_v2(VID, BLOB, [LOC_A, LOC_B])
        res = run(cfg_v2(c, vault_id=VID))
    assert bytes(res.secret) == SECRET


def test_stuffed_locator_over_1000_entries_pages_and_batches() -> None:
    """Spec scenario: >1,000 entries resolve in pages of <=256 and getVaults batches of <=32."""
    with FakeChain() as c:
        c.enable_v2()
        c.stuff_v2(LOC_A, 600, tag=1)
        c.add_vault_v2(VID, BLOB, [LOC_A, LOC_B])
        c.stuff_v2(LOC_A, 600, tag=2)
        c.stuff_v2(LOC_B, 1100, tag=3)
        res = run(cfg_v2(c, v1=False))
        calls = c.v2_calls
    assert bytes(res.secret) == SECRET and res.candidate.vault_id == VID
    assert calls.pages and all(count <= 256 for _, _, count in calls.pages)
    assert max(len([p for p in calls.pages if p[0] == LOC_A]), 0) == 5  # 1,201 entries -> 5 pages
    assert calls.batches and max(calls.batches) <= 32


def test_paging_is_bounded_against_a_lying_length(monkeypatch: pytest.MonkeyPatch) -> None:
    """A hostile locatorLength (2**200) cannot make us page forever: bounded pages, a warning."""
    with FakeChain() as c:
        c.enable_v2()
        c.add_vault_v2(VID, BLOB, [LOC_A])
        c.v2_length_override = 2**200
        reg = registries(c, v1=False)
        ids = reg.resolve([LOC_A])
        pages = len(c.v2_calls.pages)
    assert VID in ids
    assert pages <= chain_mod.MAX_LOCATOR_PAGES
    assert any("only part" in w for w in reg.warnings)


def test_short_page_stops_paging() -> None:
    """The list ends early (a lying length): paging stops at the first short page."""
    with FakeChain() as c:
        c.enable_v2()
        c.add_vault_v2(VID, BLOB, [LOC_A])
        c.v2_length_override = 5_000
        reg = registries(c, v1=False)
        assert reg.resolve([LOC_A]) == [VID]
        assert len(c.v2_calls.pages) == 1


def test_head_and_tail_pages_when_over_budget(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pre-stuffing (a locator public from v1 or another chain) pushes the victim's entry to the END;
    over the page budget we read the oldest pages AND the newest, so it is still found."""
    monkeypatch.setattr(chain_mod, "MAX_LOCATOR_PAGES", 4)
    monkeypatch.setattr(chain_mod, "TAIL_PAGES", 1)
    with FakeChain() as c:
        c.enable_v2()
        c.stuff_v2(LOC_A, 256 * 6, tag=4)
        c.add_vault_v2(VID, BLOB, [LOC_A])
        reg = registries(c, v1=False)
        ids = reg.resolve([LOC_A])
        starts = [s for _, s, _ in c.v2_calls.pages]
    assert VID in ids
    # oldest 3 pages, then exactly the newest 256 entries (1,537 - 256)
    assert starts == [0, 256, 512, 256 * 6 + 1 - 256]
    assert any("only part" in w for w in reg.warnings)


def test_page_with_too_many_ids_is_discarded() -> None:
    with FakeChain() as c:
        c.enable_v2()
        c.add_vault_v2(VID, BLOB, [LOC_A])
        c.v2_page_extra = 3
        reg = registries(c, v1=False)
        assert reg.resolve([LOC_A]) == []
    assert any("resolveLocator" in w for w in reg.warnings)


def test_get_vaults_wrong_count_is_discarded() -> None:
    with FakeChain() as c:
        c.enable_v2()
        c.add_vault_v2(VID, BLOB, [LOC_A])
        c.v2_getvaults_drop = 1
        reg = registries(c, v1=False)
        assert reg.fetch([VID]) == []
    assert any("getVaults" in w for w in reg.warnings)


def test_overall_deadline_stops_paging(monkeypatch: pytest.MonkeyPatch) -> None:
    """REC-L1 style: one state deadline per run; once spent, no further pages or batches are sent."""
    now = [0.0]

    class Clock:
        @staticmethod
        def monotonic() -> float:
            now[0] += 7.0  # every check costs 7 s
            return now[0]

    monkeypatch.setattr(chain_mod, "time", Clock)
    with FakeChain() as c:
        c.enable_v2()
        c.stuff_v2(LOC_A, 256 * 40, tag=5)
        reg = registries(c, v1=False)
        reg.resolve([LOC_A])
        assert len(c.v2_calls.pages) < 40
    assert any("deadline" in w for w in reg.warnings)


def test_quorum_across_two_rpcs_for_v2() -> None:
    """REC-M1 is kept: support counts distinct RPCs, and one disagreeing RPC is not 'current'."""
    with FakeChain() as a, FakeChain() as b:
        for c in (a, b):
            c.enable_v2()
            c.add_vault_v2(VID, BLOB, [LOC_A])
        reg = registries(a, b)
        assert reg.quorum == 2
        (cand,) = reg.fetch(reg.resolve([LOC_A]))
    assert cand.support == 2 and cand.freshness is Freshness.CURRENT


def test_one_probe_per_rpc_for_both_registries() -> None:
    with FakeChain() as c:
        c.enable_v2()
        c.add_vault_v2(VID, BLOB, [LOC_A])
        reg = registries(c)
        reg.fetch(reg.resolve([LOC_A]))
        probes = [r for r in c.requests if json.loads(r.body)["method"] == "eth_chainId"]
    assert len(probes) == 1


# ------------------------------------------------------------------ cross-registry rollback
def test_old_blob_planted_in_v1_under_a_v2_id_is_demoted() -> None:
    """v1 accepts client-chosen ids, so anyone can re-register a v2 vault's id in v1 with an OLDER genuine
    blob (it still decrypts: the AAD binds only the vaultId). v2's own history wins."""
    new = h(UPDATE["expectedBlob"])
    assert new != BLOB and h(UPDATE["vaultId"]) == VID
    with FakeChain() as c:
        c.enable_v2()
        c.add_vault_v2(VID, BLOB, [LOC_A, LOC_B])
        c.update_vault_v2(VID, new)
        c.add_vault(VID, BLOB, [LOC_A, LOC_B], owner="0x" + "66" * 20)  # the plant: old blob in v1
        reg = registries(c)
        cands = reg.fetch(reg.resolve([LOC_A, LOC_B]))
    by_src = {("v2" in x.origin): x for x in cands if x.vault_id == VID}
    assert by_src[True].blob == new and by_src[True].freshness is Freshness.CURRENT
    assert by_src[False].blob == BLOB and by_src[False].freshness is Freshness.UNMATCHED
    assert any("SECURITY" in w and "v1" in w for w in reg.warnings)


def test_planted_v1_copy_never_opens_end_to_end() -> None:
    new = h(UPDATE["expectedBlob"])
    with FakeChain() as c:
        c.enable_v2()
        c.add_vault_v2(VID, BLOB, [LOC_A, LOC_B])
        c.update_vault_v2(VID, new)
        c.add_vault(VID, BLOB, [LOC_A, LOC_B], owner="0x" + "66" * 20)
        ui = RecUI()
        prf = FakePrfSource([PhysicalKey.named("A", "B")], ui=ui)
        res = Recovery(cfg_v2(c), prf, ui).run()
    assert res.candidate.blob == new
    assert bytes(res.secret) == h(UPDATE["newSecret"])


def test_unverifiable_v2_history_caps_both_copies() -> None:
    """Without an agreed v2 history neither registry's copy may be called current (REC-M1)."""
    new = h(UPDATE["expectedBlob"])
    with FakeChain() as c:
        c.enable_v2()
        c.add_vault_v2(VID, BLOB, [LOC_A, LOC_B])
        c.update_vault_v2(VID, new)
        c.add_vault(VID, BLOB, [LOC_A, LOC_B], owner="0x" + "66" * 20)
        c.logs_error = True
        reg = registries(c)
        cands = reg.fetch(reg.resolve([LOC_A, LOC_B]))
    assert {x.freshness for x in cands if x.vault_id == VID} == {Freshness.UNVERIFIABLE}


def test_v2_copy_without_v2_history_is_demoted() -> None:
    """A lying RPC serves an old v1 blob as if v2 had it; agreed v2 history (none) exposes it."""
    with FakeChain() as c:
        c.enable_v2()
        c.add_vault(VID, BLOB, [LOC_A, LOC_B])
        c.add_vault_v2(VID, b"fake v2 copy", [LOC_A], log=False)  # no v2 events: never really created
        reg = registries(c)
        cands = reg.fetch(reg.resolve([LOC_A, LOC_B]))
    by_src = {("v2" in x.origin): x for x in cands if x.vault_id == VID}
    assert by_src[True].freshness is Freshness.UNMATCHED
    assert by_src[False].freshness is Freshness.CURRENT


def test_arweave_copy_is_classified_against_v2_history() -> None:
    with FakeChain() as c:
        c.enable_v2()
        c.add_vault_v2(VID, BLOB, [LOC_A, LOC_B])
        reg = registries(c)
        assert reg.event_hashes(VID) == [(1, keccak256(BLOB))]
        assert reg.event_hashes(b"\x09" * 32) == []


def test_arweave_fallback_with_both_registries() -> None:
    """REC-M2 path unchanged: an Arweave-only copy still opens, verified against v2 history."""
    with FakeChain() as c, FakeArweave() as ar:
        c.enable_v2()
        c.add_vault_v2(VID, BLOB, [], log=True)  # on chain but not under the key's locators
        ar.mirror(BLOB, vault_id=VID, locators=[LOC_A, LOC_B], version=1)
        res = run(cfg_v2(c, ar=ar))
    assert bytes(res.secret) == SECRET
    assert res.candidate.source == "arweave" and res.candidate.freshness is Freshness.VERIFIED


def test_nothing_found_in_either_registry() -> None:
    with FakeChain() as c:
        c.enable_v2()
        with pytest.raises(RecoveryError) as ei:
            run(cfg_v2(c))
    assert ei.value.exit_code == ExitCode.NO_MATCHING_VAULT


def test_unknown_id_in_get_vaults_is_skipped() -> None:
    with FakeChain() as c:
        c.enable_v2()
        reg = registries(c, v1=False)
        assert reg.fetch([b"\x03" * 32]) == []


def test_enc_vault_helper_matches_v1_decoder() -> None:
    assert abi.decode_vault(enc_vault("0x" + "11" * 20, b"q", 2)) == ("0x" + "11" * 20, b"q", 2)


# ------------------------------------------------------------------ vaultIdDerivation vector
def _derivation_cases() -> list[dict[str, Any]]:
    return list(vectors.load().get("vaultIdDerivation", []))


@pytest.mark.skipif(not _derivation_cases(), reason="vaultIdDerivation vector not added yet (task 3.1)")
@pytest.mark.parametrize("case", _derivation_cases(), ids=lambda c: str(c.get("name", "case")))
def test_vault_id_derivation_vector(case: dict[str, Any]) -> None:
    """keccak256(abi.encode(owner, salt)): an independent check of the shared vector (design D9)."""
    owner = bytes.fromhex(case["owner"].removeprefix("0x"))
    salt = h(case["salt"].removeprefix("0x"))
    assert len(owner) == 20 and len(salt) == 32
    assert keccak256(bytes(12) + owner + salt) == h(case["vaultId"].removeprefix("0x"))


def test_full_size_batch_splits_under_the_response_cap() -> None:
    """32 x 1 KB blobs (~76 KB of hex) exceed the 64 KiB RPC response cap: the batch is halved, the cap
    stays, and every vault is still read."""
    with FakeChain() as c:
        c.enable_v2()
        ids = [keccak256(b"big" + bytes([i])) for i in range(40)]
        for i, vid in enumerate(ids):
            c.add_vault_v2(vid, bytes([i]) * 1024, [LOC_A], owner="0x" + "44" * 20, log=False)
        reg = registries(c, v1=False)
        cands = reg.fetch(reg.resolve([LOC_A]))
        batches = c.v2_calls.batches
    assert len(cands) == 40
    assert max(batches) == 32 and 16 in batches


def test_recreated_v2_vault_opens_before_the_old_v1_vault() -> None:
    """Migration (design D8): the same key has an old v1 vault and a re-created v2 vault (different
    ids). v2 is read first, so the re-created vault opens; the old one stays reachable by --vault-id."""
    import os

    from support import writer

    from cryoshield_recover.format import MODE_ANY_OF_N

    v2_id = keccak256(b"recreated")
    creds = [(h(BY_NAME["A"]["id"]), bytearray(h(BY_NAME["A"]["prf"])))]
    creds.append((h(BY_NAME["B"]["id"]), bytearray(h(BY_NAME["B"]["prf"]))))
    v2_blob = writer.create(
        vault_id=v2_id,
        rp_id="cryoshield.app",
        credentials=creds,
        secret=b"new",
        mode=MODE_ANY_OF_N,
        threshold=1,
        rng=writer.FixedRng(os.urandom(200)),
    )
    with FakeChain() as c:
        c.enable_v2()
        c.add_vault(VID, BLOB, [LOC_A, LOC_B])
        c.add_vault_v2(v2_id, v2_blob, [LOC_A, LOC_B])
        assert bytes(run(cfg_v2(c)).secret) == b"new"
        assert bytes(run(cfg_v2(c, vault_id=VID)).secret) == SECRET

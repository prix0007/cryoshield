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
from cryoshield_recover.config import Config, RegistrySpec
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
    c.registries = [RegistrySpec(2, REGISTRY_V2, 0), *(c.registries if v1 else [])]
    return c


def run(cfg: Config, ui: RecUI | None = None) -> Any:
    ui = ui or RecUI()
    prf = FakePrfSource([PhysicalKey.named("A")], ui=ui)
    return Recovery(cfg, prf, ui).run()


def registries(*chains: FakeChain, v1: bool = True) -> Registries:
    urls = [c.url for c in chains]
    specs = [RegistrySpec(2, REGISTRY_V2, 0)]
    if v1:
        specs.append(RegistrySpec(1, chains[0].address, 0))
    return Registries.build(urls, chains[0].chain_id, specs)


# ------------------------------------------------------------------ ABI
def test_v2_selectors() -> None:
    assert abi.SEL_LOCATOR_LENGTH == keccak256(b"locatorLength(bytes32)")[:4]
    assert abi.SEL_RESOLVE_LOCATOR_PAGE == keccak256(b"resolveLocator(bytes32,uint256,uint256)")[:4]
    assert abi.SEL_GET_VAULTS == keccak256(b"getVaults(bytes32[])")[:4]
    assert abi.V2_PAGE_SIZE == V2_PAGE_MAX == 256
    assert abi.V2_MAX_IDS_PER_CALL == V2_GET_VAULTS_MAX == 32


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
    assert len([p for p in calls.pages if p[0] == LOC_A]) == 5  # 1,201 entries -> 5 pages
    assert calls.batches and max(calls.batches) <= 32


def test_paging_is_bounded_against_a_lying_length() -> None:
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


def test_page_extra_ids_beyond_the_length_are_ignored() -> None:
    """A page with more ids than the length allows is truncated (review #6); a page over 256 ids is a
    lie and is discarded (test_page_decode_allows_256_not_257)."""
    with FakeChain() as c:
        c.enable_v2()
        c.add_vault_v2(VID, BLOB, [LOC_A])
        c.v2_page_extra = 3
        reg = registries(c, v1=False)
        assert reg.resolve([LOC_A]) == [VID]


def test_get_vaults_wrong_count_is_discarded() -> None:
    with FakeChain() as c:
        c.enable_v2()
        c.add_vault_v2(VID, BLOB, [LOC_A])
        c.v2_getvaults_drop = 1
        reg = registries(c, v1=False)
        assert reg.fetch([VID]) == []
    assert any("getVaults" in w for w in reg.warnings)


def test_overall_deadline_stops_paging(monkeypatch: pytest.MonkeyPatch) -> None:
    """REC-L1 style: the resolve deadline (and the per-locator cap); once spent, no further pages."""
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
    assert by_src[False].blob == BLOB and by_src[False].freshness is Freshness.OUTDATED
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


def _hex(s: str) -> bytes:
    return bytes.fromhex(s.removeprefix("0x"))


def test_vault_id_derivation_vector_present() -> None:
    """The pinned v1.json carries the v2 derivation cases (task 3.1); never skipped silently."""
    assert len(_derivation_cases()) >= 1


@pytest.mark.parametrize("case", _derivation_cases(), ids=lambda c: str(c.get("name", "case")))
def test_vault_id_derivation_vector(case: dict[str, Any]) -> None:
    """keccak256(abi.encode(owner, salt)): an independent check of the shared vector (design D9)."""
    owner, salt = _hex(case["owner"]), _hex(case["salt"])
    assert len(owner) == 20 and len(salt) == 32
    encoded = bytes(12) + owner + salt
    if "abiEncoded" in case:
        assert encoded == _hex(case["abiEncoded"])
    assert keccak256(encoded) == _hex(case["vaultId"])


def test_full_size_batch_fits_in_one_call() -> None:
    """LOW (review #8): 32 x 1 KB blobs (~76 KB of hex) fit getVaults' own response cap: no wasted call."""
    with FakeChain() as c:
        c.enable_v2()
        ids = [keccak256(b"big" + bytes([i])) for i in range(40)]
        for i, vid in enumerate(ids):
            c.add_vault_v2(vid, bytes([i]) * 1024, [LOC_A], owner="0x" + "44" * 20, log=False)
        reg = registries(c, v1=False)
        cands = reg.fetch(reg.resolve([LOC_A]))
        batches = c.v2_calls.batches
    assert len(cands) == 40
    assert batches == [32, 8]


def test_recreated_v2_vault_opens_before_the_old_v1_vault() -> None:
    """Migration (design D8): the same key has an old v1 vault and a re-created v2 vault (different
    ids). Both are listed (vault-list-labels-archive 5.1), the v2 vault first because v2 is read first;
    the old one stays reachable by choosing it or by --vault-id."""
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
        ui = RecUI(pick=lambda options: 0)
        assert bytes(run(cfg_v2(c), ui).secret) == b"new"
        assert len(ui.choices) == 1 and len(ui.choices[0]) == 2
        assert v2_id.hex()[:8] in ui.choices[0][0] and VID.hex()[:8] in ui.choices[0][1]
        assert bytes(run(cfg_v2(c), RecUI(pick=lambda options: 1)).secret) == SECRET
        assert bytes(run(cfg_v2(c, vault_id=VID)).secret) == SECRET


# ------------------------------------------------------------------ PR #40 review fixes
def _plant_setup(c: FakeChain) -> bytes:
    """A genuine v2 vault updated to ``new``, and its OLD blob planted in v1 under the same id."""
    new = h(UPDATE["expectedBlob"])
    c.enable_v2()
    c.add_vault_v2(VID, BLOB, [LOC_A, LOC_B])
    c.update_vault_v2(VID, new)
    c.add_vault(VID, BLOB, [LOC_A, LOC_B], owner="0x" + "66" * 20)
    return new


def test_v1_plant_is_not_current_when_the_v2_read_fails() -> None:
    """HIGH (review #1): v2 getVaults fails, so only the v1 plant is fetched; v2's agreed history still
    exposes it as an older version, never CURRENT."""
    with FakeChain() as c:
        _plant_setup(c)
        c.v2_getvaults_error = True
        reg = registries(c)
        cands = reg.fetch(reg.resolve([LOC_A, LOC_B]))
    (plant,) = [x for x in cands if x.vault_id == VID]
    assert plant.blob == BLOB and plant.freshness is Freshness.OUTDATED
    assert any("SECURITY" in w and "v1" in w for w in reg.warnings)


def test_v1_plant_is_unverifiable_when_v2_read_and_history_fail() -> None:
    with FakeChain() as c:
        _plant_setup(c)
        c.v2_getvaults_error = True
        c.logs_error = True
        reg = registries(c)
        cands = reg.fetch(reg.resolve([LOC_A, LOC_B]))
    (plant,) = [x for x in cands if x.vault_id == VID]
    assert plant.freshness is Freshness.UNVERIFIABLE
    assert any("SECURITY" in w and "could not be confirmed" in w for w in reg.warnings)


def test_v1_plant_with_v2_withheld_warns_end_to_end() -> None:
    """The user is told the copy is older; it is never presented as current."""
    with FakeChain() as c:
        _plant_setup(c)
        c.v2_getvaults_error = True
        res = run(cfg_v2(c))
    assert res.candidate.freshness is Freshness.OUTDATED


def test_legacy_v1_vault_keeps_its_classification() -> None:
    """Agreed-empty v2 history: a genuine v1-only vault stays CURRENT."""
    with FakeChain() as c:
        c.enable_v2()
        c.add_vault(VID, BLOB, [LOC_A, LOC_B])
        reg = registries(c)
        (cand,) = reg.fetch(reg.resolve([LOC_A, LOC_B]))
    assert cand.freshness is Freshness.CURRENT


def test_unverifiable_cross_registry_copies_force_a_choice() -> None:
    """MEDIUM (review #4): with v2 history unconfirmed, support must not silently pick the v1 plant;
    the user chooses (non-interactive runs stop with AMBIGUOUS)."""
    with FakeChain() as a, FakeChain() as b:
        _plant_setup(a)
        b.enable_v2()  # b withholds the v2 vault but serves the v1 plant: plant support 2, v2 copy 1
        b.add_vault(VID, BLOB, [LOC_A, LOC_B], owner="0x" + "66" * 20)
        a.logs_error = b.logs_error = True
        cfg = cfg_v2(a)
        cfg.rpcs = [a.url, b.url]
        ui = RecUI()
        prf = FakePrfSource([PhysicalKey.named("A", "B")], ui=ui)
        with pytest.raises(RecoveryError) as ei:
            Recovery(cfg, prf, ui).run()
    assert ei.value.exit_code == ExitCode.AMBIGUOUS
    assert ui.choices and len(ui.choices[0]) == 2


def test_slow_spamming_rpc_cannot_starve_the_honest_one(monkeypatch: pytest.MonkeyPatch) -> None:
    """HIGH (review #2): a slow RPC claiming a huge list and serving junk pages next to an honest RPC.
    resolve has its own budget (and a per-RPC, per-locator cap), so fetch still has time."""
    monkeypatch.setattr(chain_mod, "RESOLVE_DEADLINE", 2.0)
    monkeypatch.setattr(chain_mod, "LOCATOR_BUDGET", 0.8)
    monkeypatch.setattr(chain_mod, "STATE_DEADLINE", 3.0)
    with FakeChain() as slow, FakeChain() as honest:
        slow.enable_v2()
        slow.v2_spam_pages = True
        slow.v2_length_override = 10**6
        slow.v2_delay = 0.3
        honest.enable_v2()
        honest.add_vault_v2(VID, BLOB, [LOC_A, LOC_B])
        cfg = cfg_v2(honest, v1=False)
        cfg.rpcs = [slow.url, honest.url]
        res = run(cfg)
    assert bytes(res.secret) == SECRET and res.candidate.vault_id == VID


def test_resolve_orders_ids_by_support_then_position() -> None:
    """MEDIUM (review #3): a spamming first RPC cannot bury the honest id behind thousands of junk ids."""
    with FakeChain() as spam, FakeChain() as honest:
        spam.enable_v2()
        spam.v2_spam_pages = True
        spam.v2_length_override = 256 * 4
        honest.enable_v2()
        honest.stuff_v2(LOC_A, 3, tag=7)
        honest.add_vault_v2(VID, BLOB, [LOC_A])
        reg = registries(spam, honest, v1=False)
        ids = reg.resolve([LOC_A])
    assert VID in ids[:8]  # interleaved by position, not appended after 1,024 junk ids


def test_resolved_ids_are_capped_with_a_warning(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(chain_mod, "MAX_IDS_PER_LOCATOR", 100)
    with FakeChain() as spam, FakeChain() as honest:
        spam.enable_v2()
        spam.v2_spam_pages = True
        spam.v2_length_override = 256 * 4
        honest.enable_v2()
        honest.add_vault_v2(VID, BLOB, [LOC_A])
        reg = registries(spam, honest, v1=False)
        ids = reg.resolve([LOC_A])
    assert len(ids) == 100 and VID in ids[:3]  # ranked by distance from a list end: survives the cap
    assert any("--vault-id" in w for w in reg.warnings)


def test_list_growing_between_length_and_pages_keeps_the_page() -> None:
    """LOW (review #6): entries appended after locatorLength must not discard the last page."""
    with FakeChain() as c:
        c.enable_v2()
        c.stuff_v2(LOC_A, 299, tag=8)
        c.add_vault_v2(VID, BLOB, [LOC_A])  # entry 300, on the second page
        c.v2_grow_after_length = 10
        reg = registries(c, v1=False)
        ids = reg.resolve([LOC_A])
    assert VID in ids and len(ids) == 300


def test_transient_batch_error_is_retried_split() -> None:
    """LOW (review #7): a non-size getVaults error splits and retries instead of dropping 32 ids."""
    with FakeChain() as c:
        c.enable_v2()
        c.stuff_v2(LOC_A, 40, tag=9)
        c.add_vault_v2(VID, BLOB, [LOC_A])
        c.v2_getvaults_fail_once = 1
        reg = registries(c, v1=False)
        cands = reg.fetch(reg.resolve([LOC_A]))
    assert len(cands) == 41


def test_split_still_works_when_an_answer_exceeds_the_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(chain_mod, "GET_VAULTS_MAX_RESPONSE", 64 * 1024)
    with FakeChain() as c:
        c.enable_v2()
        for i in range(32):
            c.add_vault_v2(keccak256(b"big" + bytes([i])), bytes([i]) * 1024, [LOC_A], log=False)
        reg = registries(c, v1=False)
        cands = reg.fetch(reg.resolve([LOC_A]))
        batches = c.v2_calls.batches
    assert len(cands) == 32 and batches[:3] == [32, 16, 16]


def test_persistently_failing_rpc_is_not_retried_forever() -> None:
    with FakeChain() as c:
        c.enable_v2()
        c.stuff_v2(LOC_A, 256, tag=10)
        c.v2_getvaults_error = True
        reg = registries(c, v1=False)
        assert reg.fetch(reg.resolve([LOC_A])) == []
        calls = len(c.v2_calls.batches)
    assert calls <= chain_mod.MAX_BATCH_FAILURES + 1
    assert any("keeps failing" in w for w in reg.warnings)


# ------------------------------------------------------------------ PR #40 re-review fixes
def test_vault_behind_9000_entries_is_found_with_real_constants() -> None:
    """HIGH (re-review #1): pre-stuffed beyond the page budget; the vault is the LAST entry. The tail
    pages must survive the candidate cap (real constants, no monkeypatching)."""
    with FakeChain() as c:
        c.enable_v2()
        c.stuff_v2(LOC_A, 9000, tag=20)
        c.add_vault_v2(VID, BLOB, [LOC_A])
        res = run(cfg_v2(c, v1=False))
    assert bytes(res.secret) == SECRET


def test_vault_last_in_a_second_stuffed_locator_is_found() -> None:
    """HIGH (re-review #1): the first locator's junk must not push the second locator's ids past the
    cap; here both lists hold 5,000 junk entries and the vault is last under the second one only."""
    with FakeChain() as c:
        c.enable_v2()
        c.stuff_v2(LOC_A, 5000, tag=21)
        c.stuff_v2(LOC_B, 5000, tag=22)
        c.add_vault_v2(VID, BLOB, [LOC_B])
        reg = registries(c, v1=False)
        ids = reg.resolve([LOC_A, LOC_B])
        ui = RecUI()
        prf = FakePrfSource([PhysicalKey.named("A", "B")], ui=ui)  # one key, two locators: A then B
        res = Recovery(cfg_v2(c, v1=False), prf, ui).run()
    assert VID in ids
    assert bytes(res.secret) == SECRET


def test_hung_rpc_cannot_starve_the_v1_read(monkeypatch: pytest.MonkeyPatch) -> None:
    """HIGH (re-review #2): both registries; one RPC answers eth_chainId then hangs on every eth_call;
    a v1-only vault on the honest RPC must still be found (per-registry budgets, per-RPC cap)."""
    monkeypatch.setattr(chain_mod, "RESOLVE_DEADLINE", 2.0)
    monkeypatch.setattr(chain_mod, "LOCATOR_BUDGET", 0.8)
    monkeypatch.setattr(chain_mod, "STATE_DEADLINE", 3.0)
    monkeypatch.setattr(chain_mod, "RPC_FETCH_BUDGET", 1.0)
    with FakeChain() as hung, FakeChain() as honest:
        hung.enable_v2()
        hung.call_delay = 2.5
        honest.enable_v2()
        honest.stuff_v2(LOC_A, 40, tag=23)  # several v2 ids, so the v2 fetch has batches to hang on
        honest.add_vault(VID, BLOB, [LOC_A, LOC_B])
        cfg = cfg_v2(honest, timeout=2)
        cfg.rpcs = [hung.url, honest.url]
        res = run(cfg)
    assert bytes(res.secret) == SECRET


def test_always_too_large_rpc_cannot_force_unbounded_splitting() -> None:
    """MEDIUM (re-review #4): a too-large single id counts as a failure; calls per RPC are bounded."""
    with FakeChain() as c:
        c.enable_v2()
        c.stuff_v2(LOC_A, 64, tag=24)
        c.v2_too_large = True
        reg = registries(c, v1=False)
        reg.fetch(reg.resolve([LOC_A]))
        calls = len(c.v2_calls.batches)
    assert calls <= 3 * 2 + chain_mod.MAX_BATCH_FAILURES


def test_outdated_chain_copy_consults_arweave() -> None:
    """MEDIUM (re-review #5): the only chain copy is an OUTDATED v1 plant (v2 read failed); the current
    copy mirrored on Arweave is found and preferred instead of opening the plant with a warning."""
    with FakeChain() as c, FakeArweave() as ar:
        new = _plant_setup(c)
        c.v2_getvaults_error = True
        ar.mirror(new, vault_id=VID, locators=[LOC_A, LOC_B], version=2)
        ui = RecUI()
        prf = FakePrfSource([PhysicalKey.named("A", "B")], ui=ui)
        res = Recovery(cfg_v2(c, ar=ar), prf, ui).run()
    assert res.candidate.blob == new and res.candidate.freshness is Freshness.VERIFIED


def test_malformed_batch_is_split_and_retried() -> None:
    """LOW (re-review #8)."""
    with FakeChain() as c:
        c.enable_v2()
        c.stuff_v2(LOC_A, 40, tag=25)
        c.add_vault_v2(VID, BLOB, [LOC_A])
        c.v2_getvaults_malformed_once = 1
        reg = registries(c, v1=False)
        assert len(reg.fetch(reg.resolve([LOC_A]))) == 41


def test_absurd_length_does_not_lose_the_rpcs_other_results() -> None:
    """LOW (re-review #9): locatorLength near 2**256 with full junk pages reaches tail starts that do not
    fit uint256; the head pages already read are kept, no exception escapes."""
    with FakeChain() as c:
        c.enable_v2()
        c.v2_spam_pages = True
        c.v2_length_override = 2**256 - 1
        reg = registries(c, v1=False)
        ids = reg.resolve([LOC_A])
    assert len(ids) >= 256

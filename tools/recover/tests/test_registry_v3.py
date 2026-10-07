"""Three registry versions on one chain (OpenSpec change recover-registry-versions, task 3.1).

A fake v3 with v2's ABI is served next to v2 and v1. The authority rule (design D2): the NEWEST
registry holding a vault ID is authoritative; older copies are checked against it; if a newer registry's
history can't be confirmed, no copy is current and copies from several registries are contested.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from support import vectors
from support.fakes import REGISTRY, REGISTRY_V2, REGISTRY_V3, FakeChain
from support.keys import BY_NAME, FakePrfSource, PhysicalKey
from support.vectors import h
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
NEW = h(UPDATE["expectedBlob"])
NEW_SECRET = h(UPDATE["newSecret"])
LOC_A, LOC_B = h(BY_NAME["A"]["locator"]), h(BY_NAME["B"]["locator"])
SPECS = [
    RegistrySpec(3, REGISTRY_V3, 0, abi_kind=2),
    RegistrySpec(2, REGISTRY_V2, 0),
    RegistrySpec(1, REGISTRY, 0),
]


def setup(c: FakeChain) -> FakeChain:
    """Enable v2 and a fake v3 on ``c``; return v3's state."""
    assert NEW != BLOB and h(UPDATE["vaultId"]) == VID
    c.enable_v2()
    return c.add_registry(REGISTRY_V3)


def regs(*chains: FakeChain, specs: list[RegistrySpec] | None = None) -> Registries:
    return Registries.build([c.url for c in chains], chains[0].chain_id, specs or SPECS)


def cfg3(c: FakeChain, **kw: Any) -> Config:
    return cfg_for(c, registries=list(SPECS), **kw)


def run(cfg: Config, ui: RecUI | None = None) -> Any:
    ui = ui or RecUI()
    prf = FakePrfSource([PhysicalKey.named("A", "B")], ui=ui)
    return Recovery(cfg, prf, ui).run()


def by_registry(cands: list[Any], vid: bytes = VID) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for x in cands:
        if x.vault_id == vid:
            out[x.origin.split(":")[0].removeprefix("registry ")] = x
    return out


# ------------------------------------------------------------------ list reads
def test_three_registries_resolved_newest_first_one_list() -> None:
    id2, id1 = b"\x02" * 32, b"\x01" * 32
    with FakeChain() as c:
        v3 = setup(c)
        v3.add_vault_v2(VID, BLOB, [LOC_A])
        c.add_vault_v2(id2, b"v2 blob", [LOC_A])
        c.add_vault(id1, b"v1 blob", [LOC_A])
        reg = regs(c)
        ids = reg.resolve([LOC_A])
        cands = reg.fetch(ids)
    assert ids == [VID, id2, id1]
    origins = {x.vault_id: x.origin for x in cands}
    assert origins[VID].startswith("registry v3") and origins[id2].startswith("registry v2")
    assert origins[id1].startswith("registry v1")
    assert all(x.freshness is Freshness.CURRENT for x in cands)


def test_registries_are_sorted_newest_first_whatever_the_input_order() -> None:
    with FakeChain() as c:
        setup(c)
        reg = regs(c, specs=list(reversed(SPECS)))
    assert [r.version for r in reg.registries] == [3, 2, 1]
    assert [r.kind for r in reg.registries] == [2, 2, 1]


def test_v3_only_vault_recovers_end_to_end() -> None:
    with FakeChain() as c:
        v3 = setup(c)
        v3.add_vault_v2(VID, BLOB, [LOC_A, LOC_B])
        res = run(cfg3(c))
    assert bytes(res.secret) == SECRET and res.candidate.origin.startswith("registry v3")


def test_vault_id_mode_reads_all_three() -> None:
    with FakeChain() as c:
        v3 = setup(c)
        v3.add_vault_v2(VID, BLOB, [])
        res = run(cfg3(c, vault_id=VID))
    assert bytes(res.secret) == SECRET


# ------------------------------------------------------------------ authority rule (D2)
def test_v2_copy_superseded_by_v3_is_outdated() -> None:
    with FakeChain() as c:
        v3 = setup(c)
        c.add_vault_v2(VID, BLOB, [LOC_A, LOC_B])
        v3.add_vault_v2(VID, BLOB, [LOC_A, LOC_B])
        v3.update_vault_v2(VID, NEW)
        reg = regs(c)
        got = by_registry(reg.fetch(reg.resolve([LOC_A, LOC_B])))
    assert got["v3"].blob == NEW and got["v3"].freshness is Freshness.CURRENT
    assert got["v2"].blob == BLOB and got["v2"].freshness is Freshness.OUTDATED
    assert any("SECURITY" in w and "v2" in w and "v3" in w for w in reg.warnings)


def test_superseded_v2_copy_never_opens_end_to_end() -> None:
    with FakeChain() as c:
        v3 = setup(c)
        c.add_vault_v2(VID, BLOB, [LOC_A, LOC_B])
        v3.add_vault_v2(VID, BLOB, [LOC_A, LOC_B])
        v3.update_vault_v2(VID, NEW)
        res = run(cfg3(c))
    assert res.candidate.blob == NEW and bytes(res.secret) == NEW_SECRET


def test_v1_plant_of_a_v3_vault_is_checked_against_v3() -> None:
    """v2's history for the id is agreed empty, so the walk continues to v3's (newest first)."""
    with FakeChain() as c:
        v3 = setup(c)
        v3.add_vault_v2(VID, BLOB, [LOC_A, LOC_B])
        v3.update_vault_v2(VID, NEW)
        c.add_vault(VID, BLOB, [LOC_A, LOC_B], owner="0x" + "66" * 20)  # the plant: old blob in v1
        reg = regs(c)
        got = by_registry(reg.fetch(reg.resolve([LOC_A, LOC_B])))
        res = run(cfg3(c))
    assert got["v1"].freshness is Freshness.OUTDATED and got["v3"].freshness is Freshness.CURRENT
    assert any("SECURITY" in w and "v1" in w for w in reg.warnings)
    assert res.candidate.blob == NEW


def test_v1_plant_while_the_v3_read_fails_is_still_outdated() -> None:
    """v3's getVaults fails, so no v3 copy is read; v3's agreed history still exposes the plant."""
    with FakeChain() as c:
        v3 = setup(c)
        v3.add_vault_v2(VID, BLOB, [LOC_A, LOC_B])
        v3.update_vault_v2(VID, NEW)
        v3.v2_getvaults_error = True
        c.add_vault(VID, BLOB, [LOC_A, LOC_B], owner="0x" + "66" * 20)
        reg = regs(c)
        cands = reg.fetch(reg.resolve([LOC_A, LOC_B]))
    (plant,) = [x for x in cands if x.vault_id == VID]
    assert plant.freshness is Freshness.OUTDATED


def test_unverifiable_v3_history_contests_v3_and_v2_copies() -> None:
    with FakeChain() as c:
        v3 = setup(c)
        c.add_vault_v2(VID, BLOB, [LOC_A, LOC_B])
        v3.add_vault_v2(VID, BLOB, [LOC_A, LOC_B])
        v3.update_vault_v2(VID, NEW)
        v3.logs_error = True
        reg = regs(c)
        got = by_registry(reg.fetch(reg.resolve([LOC_A, LOC_B])))
    assert {x.freshness for x in got.values()} == {Freshness.UNVERIFIABLE}
    assert got["v3"].contested and got["v2"].contested
    assert any("SECURITY" in w and "could not be confirmed" in w and "v3" in w for w in reg.warnings)


def test_unverifiable_v3_history_forces_a_choice_non_interactive_exit_12() -> None:
    with FakeChain() as c:
        v3 = setup(c)
        c.add_vault_v2(VID, BLOB, [LOC_A, LOC_B])
        v3.add_vault_v2(VID, BLOB, [LOC_A, LOC_B])
        v3.update_vault_v2(VID, NEW)
        v3.logs_error = True
        ui = RecUI()  # pick=None: no choice possible
        with pytest.raises(RecoveryError) as ei:
            run(cfg3(c, use_arweave=False), ui)
    assert ei.value.exit_code == ExitCode.AMBIGUOUS
    assert ui.choices and len(ui.choices[-1]) == 2


def test_unverifiable_v3_history_leaves_a_lone_v2_copy_uncontested() -> None:
    """Trade-off (design D2): the copy opens, but it is no longer called current."""
    with FakeChain() as c:
        v3 = setup(c)
        c.add_vault_v2(VID, BLOB, [LOC_A, LOC_B])
        v3.logs_error = True
        reg = regs(c)
        got = by_registry(reg.fetch(reg.resolve([LOC_A, LOC_B])))
        res = run(cfg3(c, use_arweave=False))
    assert got["v2"].freshness is Freshness.UNVERIFIABLE and not got["v2"].contested
    assert bytes(res.secret) == SECRET


def test_v3_copy_without_v3_history_is_unmatched() -> None:
    """A lying RPC serves a v3 copy of an id v3 never created; v2 holds it with an agreed history."""
    with FakeChain() as c:
        v3 = setup(c)
        c.add_vault_v2(VID, BLOB, [LOC_A, LOC_B])
        v3.add_vault_v2(VID, NEW, [LOC_A], log=False)
        reg = regs(c)
        got = by_registry(reg.fetch(reg.resolve([LOC_A, LOC_B])))
    assert got["v3"].freshness is Freshness.UNMATCHED
    assert got["v2"].freshness is Freshness.CURRENT


def test_middle_registry_is_authoritative_over_v1() -> None:
    """v3 agrees it has no such vault; v2 has it, so v2's history judges the v1 copy."""
    with FakeChain() as c:
        setup(c)
        c.add_vault_v2(VID, BLOB, [LOC_A, LOC_B])
        c.update_vault_v2(VID, NEW)
        c.add_vault(VID, BLOB, [LOC_A, LOC_B], owner="0x" + "66" * 20)
        reg = regs(c)
        got = by_registry(reg.fetch(reg.resolve([LOC_A, LOC_B])))
    assert got["v2"].freshness is Freshness.CURRENT and got["v1"].freshness is Freshness.OUTDATED


def test_legacy_v1_vault_keeps_its_classification_with_three_registries() -> None:
    with FakeChain() as c:
        setup(c)
        c.add_vault(VID, BLOB, [LOC_A, LOC_B])
        reg = regs(c)
        got = by_registry(reg.fetch(reg.resolve([LOC_A, LOC_B])))
    assert got["v1"].freshness is Freshness.CURRENT and not got["v1"].contested


def test_event_hashes_walk_newest_first() -> None:
    with FakeChain() as c:
        v3 = setup(c)
        c.add_vault_v2(VID, BLOB, [LOC_A])
        reg = regs(c)
        assert reg.event_hashes(VID) == [(1, keccak256(BLOB))]  # v3 empty -> v2's
        assert reg.event_hashes(b"\x09" * 32) == []
    with FakeChain() as c:
        v3 = setup(c)
        v3.add_vault_v2(VID, NEW, [LOC_A])
        c.add_vault_v2(VID, BLOB, [LOC_A])
        reg = regs(c)
        assert reg.event_hashes(VID) == [(1, keccak256(NEW))]  # v3 non-empty wins
    with FakeChain() as c:
        v3 = setup(c)
        c.add_vault_v2(VID, BLOB, [LOC_A])
        v3.logs_error = True
        reg = regs(c)
        assert reg.event_hashes(VID) is None  # v3 unverifiable: never fall back to v2


# ------------------------------------------------------------------ cost and budgets (D3)
def test_v1_getvault_skips_ids_found_only_through_v2_abi_lists() -> None:
    with FakeChain() as c:
        v3 = setup(c)
        v3.add_vault_v2(VID, BLOB, [LOC_A])
        reg = regs(c)
        reg.fetch(reg.resolve([LOC_A]))
        calls = [json.loads(r.body) for r in c.requests if json.loads(r.body)["method"] == "eth_call"]
    v1_getvault = [
        x
        for x in calls
        if x["params"][0]["to"].lower() == REGISTRY
        and bytes.fromhex(x["params"][0]["data"][2:])[:4] == abi.SEL_GET_VAULT
    ]
    assert v1_getvault == []
    targets = {x["params"][0]["to"].lower() for x in calls}
    assert targets == {REGISTRY, REGISTRY_V2, REGISTRY_V3}  # every registry was resolved


def test_hung_v3_cannot_starve_v2_or_v1(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(chain_mod, "RESOLVE_DEADLINE", 2.0)
    monkeypatch.setattr(chain_mod, "LOCATOR_BUDGET", 0.8)
    monkeypatch.setattr(chain_mod, "STATE_DEADLINE", 3.0)
    monkeypatch.setattr(chain_mod, "RPC_FETCH_BUDGET", 1.0)
    with FakeChain() as c:
        v3 = setup(c)
        v3.v2_delay = 2.5  # every v3 call hangs
        c.add_vault(VID, BLOB, [LOC_A, LOC_B])
        res = run(cfg3(c, timeout=2, use_arweave=False))
    assert bytes(res.secret) == SECRET

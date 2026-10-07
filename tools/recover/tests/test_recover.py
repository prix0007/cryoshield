"""Recovery orchestration with fake key, fake chain and fake Arweave (tasks 7.4, 9.2)."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest
from support import vectors
from support.fakes import FakeArweave, FakeChain
from support.keys import BY_NAME, FakePrfSource, PhysicalKey
from support.vectors import h

from cryoshield_recover.candidates import Freshness
from cryoshield_recover.config import Config, RegistrySpec
from cryoshield_recover.derive import derive_wrap_key
from cryoshield_recover.errors import ExitCode, RecoveryError
from cryoshield_recover.recover import Recovery

VAULTS = {v["name"]: v for v in vectors.cases("vaults")}
V2 = VAULTS["any-of-2"]
SH = VAULTS["shamir-2-of-3"]
LOC = {n: h(BY_NAME[n]["locator"]) for n in ("A", "B", "C")}
VID = h(V2["vaultId"])
JUNK_VID = b"\x02" * 32


@dataclass
class RecUI:
    messages: list[str] = field(default_factory=list)
    pauses: int = 0

    def info(self, msg: str) -> None:
        self.messages.append(msg)

    def warn(self, msg: str) -> None:
        self.messages.append("warning: " + msg)

    def pause(self, msg: str) -> None:
        self.pauses += 1
        self.messages.append(msg)

    def ask_pin(self, retries: int | None) -> str:
        return "123456"

    choices: list[list[str]] = field(default_factory=list)
    pick: Any = None  # callable(options) -> index; None means "no choice possible" (non-interactive)

    def choose(self, prompt: str, options: list[str]) -> int:
        self.choices.append(options)
        if self.pick is None:
            from cryoshield_recover.errors import ExitCode, RecoveryError

            raise RecoveryError(ExitCode.AMBIGUOUS, "ambiguous")
        return int(self.pick(options))


def cfg_for(chain: FakeChain | None = None, ar: FakeArweave | None = None, **kw: Any) -> Config:
    c = Config(
        rpcs=[chain.url] if chain else [],
        # Fake chains start at block 0 (the real op-sepolia preset is far higher).
        registries=[RegistrySpec(1, chain.address, 0)] if chain else [],
        chain_id=chain.chain_id if chain else 11155420,
        arweave_graphql=[ar.graphql_url] if ar else [],
        arweave_gateways=[ar.url] if ar else [],
        timeout=3,
    )
    for k, v in kw.items():
        setattr(c, k, v)
    return c


@pytest.fixture
def chain() -> Any:
    with FakeChain() as c:
        c.add_vault(JUNK_VID, b"CRYO" + b"\x00" * 60, [LOC["A"]], owner="0x" + "33" * 20)
        c.add_vault(VID, h(V2["blob"]), [LOC["A"], LOC["B"]])
        yield c


@pytest.fixture
def ar() -> Any:
    with FakeArweave() as a:
        yield a


def run(cfg: Config, keys: list[PhysicalKey], ui: RecUI | None = None) -> tuple[Any, FakePrfSource, RecUI]:
    ui = ui or RecUI()
    prf = FakePrfSource(keys, ui=ui)
    return Recovery(cfg, prf, ui).run(), prf, ui


def test_keyless_discovery_via_chain(chain: FakeChain) -> None:
    res, prf, _ = run(cfg_for(chain), [PhysicalKey.named("A")])
    assert bytes(res.secret) == h(V2["secret"])
    assert res.candidate.source == "chain" and res.candidate.freshness is Freshness.CURRENT
    assert res.candidate.vault_id == VID
    assert res.ignored == 1  # the junk vault under the same locator
    assert prf.calls == [("cryoshield.app", None)]
    assert all(b == bytearray(32) for b in prf.handed_out), "PRF outputs must be wiped after the run"


def test_several_discoverable_credentials_one_tap(chain: FakeChain) -> None:
    key = PhysicalKey.named("C", "B")  # C has no vault on this chain, B does
    res, prf, _ = run(cfg_for(chain), [key])
    assert bytes(res.secret) == h(V2["secret"]) and len(prf.calls) == 1


def test_chain_down_falls_back_to_arweave(chain: FakeChain, ar: FakeArweave) -> None:
    chain.down = True
    ar.mirror(h(V2["blob"]), vault_id=VID, locators=[LOC["A"], LOC["B"]])
    res, _, ui = run(cfg_for(chain, ar), [PhysicalKey.named("B")])
    assert bytes(res.secret) == h(V2["secret"])
    assert res.candidate.source == "arweave" and res.candidate.freshness is Freshness.UNVERIFIABLE
    assert any("unavailable" in w for w in res.warnings)


def test_arweave_copy_verified_against_events(chain: FakeChain, ar: FakeArweave) -> None:
    chain.withhold = True  # state reads hidden, event history intact
    ar.mirror(h(V2["blob"]), vault_id=VID, locators=[LOC["A"]])
    res, _, _ = run(cfg_for(chain, ar), [PhysicalKey.named("A")])
    assert res.candidate.freshness is Freshness.VERIFIED


def test_arweave_outdated_copy_flagged(chain: FakeChain, ar: FakeArweave) -> None:
    chain.update_vault(VID, h(vectors.cases("updatePayloadCases")[0]["expectedBlob"]))
    chain.withhold = True
    ar.mirror(h(V2["blob"]), vault_id=VID, locators=[LOC["A"]])
    res, _, _ = run(cfg_for(chain, ar), [PhysicalKey.named("A")])
    assert res.candidate.freshness is Freshness.OUTDATED
    assert bytes(res.secret) == h(V2["secret"])


def test_chain_preferred_over_arweave(chain: FakeChain, ar: FakeArweave) -> None:
    ar.mirror(h(V2["blob"]), vault_id=VID, locators=[LOC["A"]])
    res, _, _ = run(cfg_for(chain, ar), [PhysicalKey.named("A")])
    assert res.candidate.source == "chain"
    assert not any(r.path == "/graphql" for r in ar.requests), "Arweave is only a fallback"


def test_vault_id_flow_non_discoverable(chain: FakeChain) -> None:
    key = PhysicalKey.named("B", discoverable=False)
    res, prf, _ = run(cfg_for(chain, vault_id=VID), [key])
    assert bytes(res.secret) == h(V2["secret"])
    assert prf.calls == [("cryoshield.app", [h(c["id"]) for c in V2["credentials"]])]


def test_vault_id_flow_unknown_vault(chain: FakeChain) -> None:
    with pytest.raises(RecoveryError) as ei:
        run(cfg_for(chain, vault_id=b"\x77" * 32), [PhysicalKey.named("A")])
    assert ei.value.exit_code == ExitCode.NO_MATCHING_VAULT


def test_credential_id_flow(chain: FakeChain) -> None:
    key = PhysicalKey.named("A", discoverable=False)
    cid = h(BY_NAME["A"]["id"])
    res, prf, _ = run(cfg_for(chain, credential_ids=[cid]), [key])
    assert bytes(res.secret) == h(V2["secret"])
    assert prf.calls == [("cryoshield.app", [cid])]


def test_blob_file_offline_makes_no_network_calls(tmp_path: Path) -> None:
    f = tmp_path / "vault.bin"
    f.write_bytes(h(V2["blob"]))

    def boom(cfg: Config) -> Any:
        raise AssertionError("network source constructed in offline mode")

    cfg = cfg_for(
        None,
        None,
        blob_file=f,
        vault_id=VID,
        offline=True,
        rpcs=["https://example.org"],
        registries=[RegistrySpec(1, "0x" + "11" * 20)],
        arweave_graphql=["https://example.org/graphql"],
        arweave_gateways=["https://example.org"],
    )
    ui = RecUI()
    prf = FakePrfSource([PhysicalKey.named("A", discoverable=False)], ui=ui)
    res = Recovery(cfg, prf, ui, registry_factory=boom, arweave_factory=boom).run()
    assert bytes(res.secret) == h(V2["secret"]) and res.candidate.freshness is Freshness.LOCAL


def test_blob_file_hex_dump_accepted(tmp_path: Path) -> None:
    f = tmp_path / "vault.hex"
    f.write_text("0x" + V2["blob"] + "\n")
    res, _, _ = run(cfg_for(None, None, blob_file=f, vault_id=VID, offline=True), [PhysicalKey.named("B")])
    assert bytes(res.secret) == h(V2["secret"])


def test_blob_rp_id_wins_over_config(tmp_path: Path) -> None:
    f = tmp_path / "vault.bin"
    f.write_bytes(h(V2["blob"]))
    res, prf, ui = run(
        cfg_for(None, None, blob_file=f, vault_id=VID, offline=True, rp_id="other.example"),
        [PhysicalKey.named("A")],
    )
    assert prf.calls[0][0] == "cryoshield.app"
    assert any("cryoshield.app" in m and "other.example" in m for m in ui.messages)


def test_shamir_sequential_taps_with_repeat() -> None:
    with FakeChain() as c:
        c.add_vault(h(SH["vaultId"]), h(SH["blob"]), [LOC["A"], LOC["C"]])
        keys = [PhysicalKey.named("A"), PhysicalKey.named("A"), PhysicalKey.named("C")]
        res, prf, ui = run(cfg_for(c), keys)
    assert bytes(res.secret) == h(SH["secret"])
    assert ui.pauses == 2
    assert any("already used" in m for m in ui.messages)
    assert len(prf.calls) == 3


def test_no_discoverable_credential() -> None:
    with pytest.raises(RecoveryError) as ei:
        run(cfg_for(None), [PhysicalKey.named("A", discoverable=False)])
    assert ei.value.exit_code == ExitCode.NO_CREDENTIAL
    for flag in ("--vault-id", "--credential-id", "--blob-file"):
        assert flag in ei.value.message


def test_no_matching_vault(chain: FakeChain) -> None:
    with pytest.raises(RecoveryError) as ei:
        run(cfg_for(chain), [PhysicalKey.named("C")])
    assert ei.value.exit_code == ExitCode.NO_MATCHING_VAULT


def test_everything_unreachable(chain: FakeChain, ar: FakeArweave) -> None:
    chain.down = True
    ar.down = True
    with pytest.raises(RecoveryError) as ei:
        run(cfg_for(chain, ar), [PhysicalKey.named("A")])
    assert ei.value.exit_code == ExitCode.NETWORK_UNAVAILABLE


def test_prf_wiped_on_failure(chain: FakeChain) -> None:
    prf = FakePrfSource([PhysicalKey.named("C")])
    with pytest.raises(RecoveryError):
        Recovery(cfg_for(chain), prf, RecUI()).run()
    assert prf.handed_out and all(b == bytearray(32) for b in prf.handed_out)


def test_traffic_contains_no_secret_material(chain: FakeChain, ar: FakeArweave) -> None:
    """Task 7.4: only allowed read methods leave the process, and no PRF/key/plaintext bytes."""
    ar.mirror(h(V2["blob"]), vault_id=VID, locators=[LOC["A"]])
    chain.withhold = True  # force the Arweave path and event-hash reads too
    run(cfg_for(chain, ar), [PhysicalKey.named("A")])
    import json

    methods = {json.loads(r.body)["method"] for r in chain.requests}
    assert methods <= {"eth_chainId", "eth_call", "eth_getLogs", "eth_blockNumber"}
    assert {r.method for r in ar.requests} <= {"GET", "POST"}
    assert all(r.path == "/graphql" for r in ar.requests if r.method == "POST")
    wire = chain.bodies() + ar.bodies()
    a = BY_NAME["A"]
    secrets = [
        h(a["prf"]),
        h(a["wrapKey"]),
        bytes(derive_wrap_key(h(a["prf"]), h(V2["wrapSalt"]))),
        h(V2["dataKey"]),
        h(V2["secret"]),
        h(V2["paddedPlaintext"]),
    ]
    for s in secrets:
        assert s not in wire and s.hex().encode() not in wire and s[:16].hex().encode() not in wire


def test_select_never_reuses_stale_decoded_vault(monkeypatch: pytest.MonkeyPatch) -> None:
    """Quality review MEDIUM 1: a decode failure must never reach the pending-Shamir path."""
    import cryoshield_recover.recover as mod
    from cryoshield_recover.candidates import Candidate
    from cryoshield_recover.errors import VaultError

    real = mod.decode_blob

    def flaky(blob: bytes) -> Any:
        if blob == b"broken":
            raise VaultError("INSUFFICIENT_SHARES")  # any code, even this one, is a decode failure
        return real(blob)

    monkeypatch.setattr(mod, "decode_blob", flaky)
    rec = Recovery(cfg_for(None), FakePrfSource([PhysicalKey.named("C")]), RecUI())
    sh = Candidate(h(SH["blob"]), "chain", "x", h(SH["vaultId"]), 1, Freshness.CURRENT)
    broken = Candidate(b"broken", "chain", "y", b"\x09" * 32, 1, Freshness.CURRENT)
    rec._tap("cryoshield.app", None)
    for order in ([broken], [sh, broken]):
        result, pending = rec._select(order)
        assert result is None
        assert all(c is not broken for c, _ in pending)
        assert all(d.mode == 2 for _, d in pending)

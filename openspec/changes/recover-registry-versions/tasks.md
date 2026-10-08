# Tasks

> **Archive after:** harden-gas-sponsorship (its "v2 is authoritative" rule is what D2 generalises). `vault-recovery` is in `openspec/specs/` since PR #44 (add-desktop-recovery-tool and harden-recovery-network-trust archived). This change MODIFIES "Built-in defaults with overrides" and ADDs the rest.

**Owners:**
- **[rec]** recovery-tool engineer
- **[ct]** contracts engineer (follow-up only)
- **[fe]** frontend engineer (follow-up only)
- **[sec]** security reviewer

**TDD:** write each listed test first, see it fail, then implement. Tests live in `tools/recover/tests/`.

## 0. Plan

- [x] 0.1 [rec] Write this change (proposal, design D1–D9 with the threat model, the `vault-recovery` delta, tasks). Verify: `openspec validate recover-registry-versions --strict` and `openspec validate --all --strict`.

## 1. Registry model and flag grammar [rec]

- [x] 1.1 [rec] Test first (`test_registry_versions.py`): `parse_registry_flag` accepts `ADDR`, `ADDR@B`, `ADDR:vN`, `ADDR@B:vN`, `ADDR@B:vN:abi=vK`. It rejects a bad address, a negative, non-decimal or ≥2^63 block, `v0`, `v01`, `v1000`, an `abi=` for v1/v2 that differs from the version, and `abi=v3`. Unknown `vN` without `abi=` raises "doesn't know registry vN; update cryoshield-recover". Then implement `RegistrySpec`, `KNOWN_ABI_KINDS`, `parse_registry_flag`, `resolve_flags`, `combine_registries` and `sort_registries` (D1, D6, D7) in `config.py`. Verify: pytest.
- [x] 1.2 [rec] Test first: the pinned ABI hashes equal keccak256 of `contracts/abi/VaultRegistry.json` and `VaultRegistryV2.json`; presets are sorted newest first, with unique versions and addresses, and at most 8 entries. Then replace the preset and `Config` field pairs with `registries` lists. Verify: pytest.

## 2. Deployment records and release files [rec]

- [x] 2.1 [rec] Test first: `deployments.parse_record` reads the real `31337.json` and `11155420.json`, and synthetic records with `contracts.vaultRegistries.v3` and `contracts.vaultRegistryV3`. It handles a v3 whose `abiHash` is v2's (kind 2), refuses an unknown `abiHash`, a conflicting duplicate version, a duplicate address, a non-object entry, a bad key and an empty record, and maps a missing `deployBlock` to 0 with `block_known=False`. A `release.json` (`config.registry` null or set, `config.registryV2`, `config.registries`) parses the same way. Files over 1 MiB and non-JSON are refused. Then implement `deployments.py`. Verify: pytest.
- [x] 2.2 [rec] Test first: the preset-vs-record parity test (D4). Each preset's list equals `parse_record` of its chain's record, and it fails when a record has a version the preset lacks (a synthetic record with v3 added fails the comparison helper). Verify: pytest.

## 3. Reads over N registries [rec]

- [x] 3.1 [rec] Test first: extend `support/fakes.py` with extra v2-ABI registries on one fake node (a fake v3). Tests with three registries:
  - all three are resolved and fetched, newest first;
  - a v3-only vault opens;
  - a v2 copy superseded by v3 is OUTDATED;
  - a v1 plant of a v3 id is not current while v2's history is empty;
  - v3's history unverifiable makes v3 and v2 copies contested (exit 12 when non-interactive);
  - a v3 copy without v3 history is UNMATCHED;
  - `event_hashes` walks newest first;
  - kind-1 fetch skips ids found only through kind-2 lists;
  - a hung v3 RPC doesn't starve v2 or v1.

  Then generalise `chain.Registries` (D2, D3). Verify: pytest, including every existing `test_registry_v2.py` case, unchanged in substance.

## 4. CLI [rec]

- [x] 4.1 [rec] Test first (`test_cli_registries.py`):
  - merge by version;
  - `--registries-only` (with and without `--registry`, and with `--deployment-file`);
  - `--deployment-file`: chain selection, conflicts, custom chain without `--rpc`, a bad file;
  - the deprecated aliases with their notes;
  - a bare `--registry` (v1, or a known entry's version);
  - block flags without that version;
  - no block means 0 with a warning;
  - the startup summary (order, sources, the security note, dropped built-ins, no secrets);
  - an unknown version refused with exit 2 before any request.

  Then implement them in `cli.py` and wire `recover.py`. Verify: pytest.
- [x] 4.2 [rec] Update the existing tests (`test_networks.py`, `test_recover.py`, `test_registry_v2.py`, `test_network_trust.py`, `test_review22.py`, `test_cli.py`, `test_anvil_v2.py`) to the list model without weakening any assertion. Verify: `uv run pytest -q` with `CRYOSHIELD_REQUIRE_FOUNDRY=1` (anvil v1 + v2 e2e passes).

## 5. Docs [rec]

- [x] 5.1 [rec] `tools/recover/README.md`: Networks (the registry list per preset), "Override registries" (the grammar, merge vs `--registries-only`, `--deployment-file`, the deprecated aliases, the security note), "How a new registry version gets picked up", and the generalised "How the tool decides which copy is current". Verify: `test_readme.py`.

## 6. Checks [rec]

- [x] 6.1 [rec] Run `uv run pytest -q`, `uv run ruff check`, `uv run ruff format --check`, `uv run mypy --strict src` (the configured scope) and `openspec validate --all --strict`. Verify: all pass.

## 9. Review fixes (local ECC review of d16be34) [rec]

- [x] 9.1 [rec] HIGH 1 (D10): tests first (`test_registry_versions.py`, `test_registry_v3.py`, `test_cli_registries.py`):
  - a phished `--registry 0xATTACKER@N:v99:abi=v2` that serves an old blob with a fake history can't beat the built-in v2, unit and end to end;
  - supplied copies are never current and are contested;
  - supplied entries are walked after the built-ins and never verify an Arweave copy;
  - a file or flag equal to a built-in entry is built-in, with no warning;
  - a chain without built-ins, and `--trust-custom-registries`, trust supplied entries with a warning;
  - the result-time, `--output` and `--save-blob` warnings.

  Then implement `RegistrySpec.trusted`, `combine_registries`, `Registries` ordering, `_cap_untrusted` and `Candidate.untrusted`. Verify: pytest.
- [x] 9.2 [rec] HIGH 2 (D11): tests first: a higher block for a built-in (version, address) is refused (flag, deprecated flag, file) and a lower one stays trusted; an untrusted empty history is unverifiable and can't demote a built-in copy. Then implement. Verify: pytest.
- [x] 9.3 [rec] MEDIUM: tests first:
  - deep nesting is refused as "not a deployment file";
  - a trailing `\n` is refused in a flag, an address, a vault ID and file keys and values (`fullmatch` everywhere, including `arweave.py`);
  - `--registry X:v1` keeps the built-in v1 and finds a genuine v1 vault end to end (M3).

  Then implement. Verify: pytest.
- [x] 9.4 [rec] LOW: tests first:
  - duplicate JSON keys are refused;
  - a read error without `strerror` names the error type;
  - file names are quoted and stripped of control characters;
  - a note appears when a bare address maps to a built-in version;
  - the reject test checks the expected message per case;
  - `--registry-v2` errors name the flag;
  - no production `assert`;
  - at most 4 supplied entries;
  - the case "v3 empty, v2 unverifiable, v1 held".

  README: the shared history deadline, and that `abiHash` is not verified on-chain. Verify: pytest, ruff, `mypy --strict src`, `openspec validate --all --strict`.

## 7. Follow-ups outside `tools/recover` (not part of this change's implementation)

- [ ] 7.1 [ct] Decide the record key for v3 and later (D5: `contracts.vaultRegistries.v<N>`, proposed) in `contracts/deployments/README.md`, `script/deploy.sh` and the deployment-targets spec, through its own change. Verify: the recovery tool's parity test passes against the new record.
- [x] 7.2 [fe] Make the web app and `release-manifest.mjs` read a registry list (`config.registries`), through its own change. Verify: that change's tests. (Done in `web-registry-versions`.)

## 8. Security review [sec]

- [x] 8.1 [sec] Review sections 1–4 against the design's threat model. Check:
  - the D2 rule equals PR #40 for v1 + v2 and never calls a copy current while a newer registry's history is unverifiable;
  - supplied registries are always announced with the security note;
  - unknown ABIs are refused, never guessed;
  - the file parser is bounded and strict;
  - no default run reads repository files;
  - per-registry budgets hold with 3 registries;
  - no secret reaches the startup summary or any error.

  Record it in `docs/reviews/recover-registry-versions.md`. Verify: no open CRITICAL or HIGH findings.

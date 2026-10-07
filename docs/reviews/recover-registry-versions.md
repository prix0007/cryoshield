# Security review: `recover-registry-versions` (task 8.1)

- **Compiled by:** the recovery-tool engineer, at the overwatcher's request, on 2026-10-08. This record collects the findings of the independent reviews below, with their fixes and the evidence. It is not a separate independent review.
- **Change:** `openspec/changes/recover-registry-versions` (proposal; design D1–D11 and the threat model; the `vault-recovery` delta; tasks).
- **Code:** `tools/recover`. Merged in PR #48 (`d379b8e`); the follow-ups are on `fix/recover-review-followups`.
- **Inputs:**
  - the local ECC review of `d16be34`: 2 HIGH, plus MEDIUM and LOW findings;
  - the ECC review on PR #48 at `cf79eea`: 0 blocking, 9 advisory;
  - the final security review of `vault-list-labels-archive` (PR #51, `docs/reviews/vault-list-labels-archive.md`), findings RT4, RT5 and N3, which touch the same code.

## Scope

| Area | Code |
|---|---|
| Registry model, flag grammar, trust rules | `config.py` (`RegistrySpec`, `parse_registry_flag`, `resolve_flags`, `combine_registries`, `sort_registries`, `abi_kind_for`, `ABI_HASHES`) |
| Deployment records and release files | `deployments.py` |
| N registries, the authority rule, capping supplied copies | `chain.py` (`Registries`, `_cross_check`, `_history`, `_cap_untrusted`), `candidates.py` (rank) |
| CLI and startup summary | `cli.py` (`--registry`, `--registries-only`, `--deployment-file`, `--trust-custom-registries`, the deprecated aliases) |
| Display (follow-ups) | `payload.py`, `recover.py`, `ui.py` |

## Threat model summary

The design's threat model holds.
- Registries come only from the built-in presets (parity-checked against the reviewed deployment records), from flags, or from a file the user names. Nothing is discovered on-chain.
- A registry the user supplies that differs from the built-ins can't outrank a built-in one, can't make a copy current, and can't hide a built-in registry.
- No registry can forge a blob that decrypts: AES-GCM and the vaultId binding stop that. The remaining risk is a rollback to an older genuine copy, and the trust rules (D10, D11) contain it.

## Findings

Status: **Fixed** (in the commit named) · **Accepted** (with the rationale) · **Open**.

### Round 1: local ECC review of `d16be34` (before push)

| # | Sev | Finding | Status |
|---|---|---|---|
| H1 | HIGH | A supplied registry (`--registry 0xATTACKER@N:v99:abi=v2`, or a tampered deployment file or release file) outranked the built-in v2 and could make an older genuine blob CURRENT | **Fixed** in `cf79eea` (in `d379b8e`), design D10. Supplied entries that differ from the built-ins are untrusted. They are walked after every built-in registry, their copies are capped at UNVERIFIABLE and contested, and their histories never verify an Arweave copy. The warning is repeated at the result. A file or flag entry equal to a built-in entry counts as built-in. `--trust-custom-registries` is an explicit opt-in. Tests: `test_phished_newer_registry_cannot_roll_back_a_built_in_vault`, `test_supplied_registry_cannot_roll_back_a_built_in_vault` |
| H2 | HIGH | A raised `deployBlock` could hide the genuine vault's first events, so its history looked "agreed empty" | **Fixed** in `cf79eea`, design D11. A higher block for a built-in (version, address) is refused; a lower one is allowed. An untrusted registry's empty history counts as unverifiable. Tests: `test_raised_built_in_block_is_refused`, `test_supplied_empty_history_is_unverifiable_never_agreed_empty` |
| M1 | MED | Deeply nested JSON raised `RecursionError` | Fixed (`cf79eea`): reported as "not a deployment file" |
| M2 | MED | `$`-anchored patterns accepted a trailing newline | Fixed (`cf79eea`): `fullmatch` everywhere, including `arweave.py` |
| M3 | MED | `--registry X:v1` replaced the built-in v1 and could hide a genuine v1 vault | Fixed (`cf79eea`): a supplied entry is read beside the built-ins, never instead of them |
| L | LOW | Duplicate JSON keys; the `strerror` fallback; file names not inert; no note for a bare address; `--registry-v2` errors without the flag name; a production `assert`; no runtime cap | Fixed (`cf79eea`): `MAX_SUPPLIED = 4` and the README documents the shared history deadline |

### Round 2: ECC review on PR #48 at `cf79eea` (0 blocking, 9 advisory)

| # | Sev | Finding | Status |
|---|---|---|---|
| A1 | MED | `MAX_SUPPLIED` also counted supplied entries equal to a built-in | **Fixed** on `fix/recover-review-followups`: the cap counts only entries that differ (`test_supplied_cap_counts_only_entries_that_differ`) |
| A2 | MED | The rank didn't put trusted copies ahead of untrusted ones, so an untrusted copy could be "Copy 1" | **Fixed**: the rank is (freshness, untrusted, support, height) (`test_trusted_copies_rank_ahead_of_supplied_ones`) |
| A3 | MED | This record did not exist | **Fixed**: this file |
| A4 | MED | A `--registry` flag silently replaced a deployment-file entry of the same version | **Fixed**: refused as "given twice" when the file's entry differs from it and isn't a built-in entry kept anyway (`test_flag_cannot_silently_replace_a_file_entry`) |
| A5 | LOW | Lowering a built-in deploy block gave no note | **Fixed**: a startup note (`test_lowering_a_built_in_block_adds_a_note`) |
| A6 | LOW | The Migration text in the design said `--registries-only` restores the old behaviour | **Fixed**: the text says both `--registries-only` and `--trust-custom-registries` are needed |
| A7 | LOW | `--chain-id` accepted 0 and negative values; `--deploy-block*` used `int()` | **Fixed**: ASCII digits only, chain ID greater than 0, below 2^63 (`test_number_flags_are_strict`) |
| A8 | LOW | A `ValueError` from `RegistrySpec` lost its file context | **Fixed**: re-raised with "registry vN:"; `UnknownRegistryVersion` passes through (`test_file_value_errors_keep_their_context`) |
| A9 | LOW | Test robustness and naming: the v4 message wasn't asserted; `builtins.open` was patched globally; `int(path.stem)`; no `encoding=` on reads; `merge_registries` and `abi_kind: 1 \| 2` in the docs | **Fixed**: the tests and the task 1.1 and D1 text are updated |

### Final security review of `vault-list-labels-archive` (PR #51): recovery-tool follow-ups

| # | Sev | Finding | Status |
|---|---|---|---|
| RT4 | MED | A dataclass `repr()` could print secret values in a traceback or debug dump | **Fixed**: `Item.__repr__` redacts `s`. `Result.secret`, `_Group.secret`, `Assertion.prf` and `UnlockKey.prf` are `repr=False`. The last-resort handler still prints only the exception type (`test_reprs_never_contain_secret_values`, `test_verbose_failure_never_prints_payload_objects`) |
| RT5 | MED | A newline in a secret could print fake framing ("----- END SECRETS -----", "Status: …") | **Fixed**: every line of a multi-line secret is printed with the fixed prefix `  \| `, and every line of the raw fallback with `\| `. `--output` stays byte-exact (`test_multi_line_secret_cannot_forge_framing`, `test_raw_fallback_cannot_forge_framing`, `test_output_file_stays_byte_exact`) |
| N3 | LOW | `--list` didn't say when the summarised copy came from a supplied registry | **Fixed**: each `--list` block has a "source:" line (built-in registry vN, SUPPLIED registry vN 0x… (not built in), the Arweave archive, or your file), beside "(may be outdated)". The chooser shows the same (`test_list_marks_the_source_registry`, `test_chooser_marks_supplied_copies`) |

The other recovery-tool items in that record (RT1, RT2, RT3, RT6 and RT7) belong to `vault-list-labels-archive` and are tracked there.

## Task 8.1 checklist

- **The D2 rule equals PR #40 for v1 + v2, and no copy is called current while a newer registry's history is unverifiable:** pass. The PR #40 unit tests are unchanged in substance (`test_registry_v2.py`). `test_registry_v3.py` covers three registries: superseded, plant, unverifiable (contested, exit 12), unverifiable middle, and a copy without history.
- **Supplied registries are always announced with the security note:** pass. The note is shown at startup and repeated at the result and next to `--output`/`--save-blob` (`test_copy_only_in_a_supplied_registry_opens_with_warnings_everywhere`). `--list` and the chooser now show the source (N3).
- **Unknown ABIs are refused, never guessed:** pass. An unknown version needs `abi=` or a known `abiHash`, otherwise the tool exits 2 before any request (`test_unknown_version_refused_before_any_request`). The ABI hashes are pinned against `contracts/abi/*.json`.
- **The file parser is bounded and strict:** pass. It has a 1 MiB cap, rejects duplicate keys and deep nesting, uses `fullmatch`, quotes names and strips control characters from them, and keeps the context in errors.
- **No default run reads repository files:** pass (`test_deployments_file_not_read_at_runtime`).
- **Per-registry budgets hold with 3 registries:** pass (`test_hung_v3_cannot_starve_v2_or_v1`). The history deadline is shared, and there are at most 4 supplied and 8 total registries.
- **No secret reaches the startup summary or any error:** pass. The summary shows only public addresses, blocks and file names. Secrets are redacted from every `repr` (RT4).

## Evidence

On `fix/recover-review-followups`:
- `CRYOSHIELD_REQUIRE_FOUNDRY=1 uv run pytest -q`: 877 passed, 5 skipped (opt-in hardware and network); the anvil v1 + v2 tests are included;
- `ruff check`, `ruff format --check` and `mypy --strict src`: clean;
- `openspec validate --all --strict`: passes.

## Residual risks (accepted)

- **A genuine registry that this release doesn't know is never called current** (D10). Its copies open with warnings until a release lists it, or until the user passes `--trust-custom-registries` with an address from the project's records.
- **`abiHash` is not checked on-chain.** It only selects the read functions. A wrong one makes reads fail or find nothing, and can't make a copy current. Documented in the README.
- **A user who opts in** with `--trust-custom-registries`, or on a chain without built-ins, can be shown an older copy by a malicious registry. A loud SECURITY warning is printed at startup.
- **Follow-ups outside the tool:** the contracts side's choice of record key (task 7.1) and a web app that reads a registry list (task 7.2).

## Verdict

**APPROVE (task 8.1). No open CRITICAL or HIGH.** Both HIGH findings (H1, H2) were fixed before merge. Every PR #48 advisory and the three recovery-tool follow-ups from the final review are fixed on `fix/recover-review-followups`, each with a test.

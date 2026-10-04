# Security review: desktop recovery tool v1

- **Change:** `openspec/changes/add-desktop-recovery-tool`
- **Scope:** `tools/recover/` (the `cryoshield-recover` Python CLI)
- **Reviewer:** `ecc:security-reviewer`, run by the overwatcher
- **Outcome:** APPROVED in round 2

## Round 1: CHANGES REQUESTED (2 HIGH, 2 MEDIUM, 4 LOW)

Each finding has a regression test, written first, in `tools/recover/tests/test_review_fixes.py`.

| # | Sev | Finding | Fix |
|---|---|---|---|
| 1 | HIGH | One hostile RPC or GraphQL response killed recovery: `[`×60000 raises RecursionError (under the 64 KB cap), `size: Infinity` raises OverflowError, and both escaped as INTERNAL. | `net.loads_untrusted` maps ValueError, RecursionError and OverflowError to `NetError`, and rejects non-finite numbers. Arweave integers go through `_as_int`, and a malformed node is skipped. Failures are contained per source in `Registry._map` and `Arweave._query`. Also fixed: a hostile server could hide a genuine tx by inflating its size, so duplicates now keep the smallest size claim. |
| 2 | HIGH | Silent rollback: disagreeing RPCs both marked their blob current, so list order could show a stale genuine blob. | `Registry._reconcile` compares copies with the latest agreed event hash, demotes the non-matching ones, and prints a visible SECURITY warning. Ranking prefers the higher version within a freshness class. |
| 3 | MEDIUM | Terminal escape injection via remote strings. | `text.sanitize` strips C0/C1 controls, DEL and format characters. It is applied in `Console.info`/`warn` and to RPC error text. |
| 4 | MEDIUM | `--vault-id` RP-ID redirection: the first decodable candidate, which could be an attacker's Arweave tag, chose the RP ID. | RP IDs are tried in this order: configured, then on-chain, file, Arweave. At most 3, each announced. |
| 5 | LOW | Event history taken from one RPC. | At least 2 identical answers are required; otherwise the history is unverifiable. "Unmatched" is reported only on an agreed empty history. |
| 6 | LOW | Supply chain. | hatchling pinned exactly, the base image pinned by digest, `uv` installed with `--require-hashes`, `binutils` pinned, the binary USB-only (`fido2.pcsc` excluded), and the README states that pipx/uvx don't use the lock. |
| 7 | LOW | No whole-request deadline. | A `read1` loop with a deadline of 2× the timeout. |
| 8 | LOW | Memory-wiping limits undocumented. | README section added: PIN string, library `bytes`, display copies, Shamir slices, swap. |

## Between rounds: vault cloning (from the web-app review)

`bind-vault-id-to-ciphertext` binds each blob to its vaultId in both AADs. The tool now opens every candidate under the vaultId of its source: the registry key, the exact `CryoShield-Vault-Id` tag, or `--vault-id` for files. `--blob-file` requires `--vault-id`.

The new regression tests caught a real bug: deduplicating by blob alone let a byte-identical clone listed first replace the genuine copy. The dedup key is now **(vaultId, blob)**. Tests: `tests/test_vault_id_binding.py`.

## Round 2: APPROVE

All round-1 findings are verified fixed, including the (vaultId, blob) dedup key and outdated Arweave copies being flagged (`OUTDATED` warning). Three new LOWs were fixed with tests:

| # | Finding | Fix |
|---|---|---|
| L1 | Without a chain, ranking relies on the attacker-writable `CryoShield-Version` tag. | Ranking is unchanged. When a copy is not chain-verified and a different blob for the same vaultId also decrypts, the tool prints a visible warning that an older copy may be shown. |
| L2 | The "2 agreeing RPCs" rule counted only reachable RPCs. | `need = min(2, configured RPCs)`, so 1 answer out of 3 configured RPCs is unverifiable. |
| L3 | Remote error text could contain `\n`, `\r` and `\t`, which could fake extra warning lines. | Whitespace is collapsed to single spaces before sanitizing. |

A separate code-quality pass ("OK to ship") also led to these fixes:
- the stale `d` in `_select` (decode and open now have separate `try` blocks; regression test added);
- `Result`-typed `_report` and an `_emit` helper;
- explicit factory keyword arguments instead of `recovery_kwargs`;
- typed `ArweaveTx` callables;
- `secure.wipe` used in `authenticator`;
- a debug log when core dumps can't be disabled;
- the Arweave fallback processes only new candidates.

## Round 3: internal security audit (2026-10)

Findings from `docs/reviews/security-audit-2026-10.md` (PR #20), fixed in the OpenSpec change `harden-recovery-network-trust`. Each audit proof is a regression test in `tools/recover/tests/test_network_trust.py`.

| ID | Sev | Finding | Fix |
|---|---|---|---|
| REC-M1 | MEDIUM (proved) | One lying RPC of three showed an older blob: variant A (version 2^32−1 plus truncated logs) and variant B (sole answer labelled current). | A `getVault` quorum of min(2, distinct configured RPCs), with duplicate URLs counted once. Ranking uses (freshness, support, height) and never a self-reported version. An exact tie requires an explicit user choice, or exit 12 in a non-interactive run. |
| REC-M2 | MEDIUM (proved) | A hostile GraphQL server hid the genuine mirror (size 0 or a relabelled vault ID); 50 newer transactions could bury it. | One record per (server, tx id); claimed sizes ignored (1 KB read cap); cursor paging (10 pages newest-first plus the oldest page) within a 60 s budget. |
| REC-L1 | LOW | A hostile `eth_blockNumber` caused about 2,000 `eth_getLogs` calls. | A median-head cross-check (±5,000 blocks), a common `to` block, fail-fast on the page budget, and a 60 s history deadline. |
| REC-L2 | LOW | `createVault` accepted identical PRF outputs. | `INVALID_ARGUMENT` in TS, the Python generator, and the test writer; new vector `duplicate-prf` (additive). |
| INFO | – | `--timeout inf`/`nan` was accepted. | Must be finite and in (0, 300]. |

## Residual risk (accepted)

- **Colluding majority:** if a majority of the configured RPCs (or every one) lies the same way about both state and event history, the user can be shown an older *genuine* version of their vault. It can't be a forgery or a clone: AES-GCM and vaultId binding prevent that.
- **No chain at all (Arweave only):** freshness can't be verified. The tool says so, and warns when several different copies decrypt.
- **Mitigations:** `--rpc` with a trusted node, and the planned L1 hash anchor.
- **Unchanged:** memory wiping is best effort (see README), and binaries are not code-signed.

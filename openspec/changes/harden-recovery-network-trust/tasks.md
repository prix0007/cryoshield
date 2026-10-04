# Tasks

Each audit proof (`proof_net.py`) becomes a failing regression test first. Commands: `uv run pytest` in `tools/recover`; `pnpm --filter @cryoshield/vault-crypto test` in `packages/vault-crypto`.

## 1. Regression tests from the audit proofs (red)

- [x] 1.1 Add `tools/recover/tests/test_network_trust.py` with the proofs as tests:
  - REC-M1 variant A (liar inflates the version and truncates logs) must select the NEW blob;
  - REC-M1 variant B (liar is the sole answer) must not be `current`;
  - REC-L1 (a hostile `eth_blockNumber` must not page `eth_getLogs`);
  - REC-M2 (a size-0 claim in either server order must still fetch; a relabel must keep a genuine-vaultId record).
  
  Verify all fail on the current code.

## 2. State quorum and ranking (REC-M1)

- [x] 2.1 Normalise and deduplicate RPC URLs in `Registry`, and compute support per (vaultId, blob). A copy is `current` only with quorum support and no disagreement; otherwise apply the agreed history. Verify variant B, duplicate URLs, and the existing reconcile tests.
- [x] 2.2 Rank by (freshness, −support, −height) and never by version. Verify variant A and the lagging-node test (the majority wins).
- [x] 2.3 On an unresolvable tie, ask for an explicit choice (`UI.choose`) that shows only metadata; a non-interactive run exits 12. Verify the 2-RPC tie tests (interactive choice, non-interactive refusal) and that no plaintext is shown before the choice.

## 3. Arweave per-server records and paging (REC-M2)

- [x] 3.1 Keep one record per (server, tx id), ignore claimed sizes, and cache downloads per tx id. Verify the size-0 (both orders) and relabel tests.
- [x] 3.2 Add cursor paging (newest first, within page and time budgets) plus the oldest page. Verify a buried-original test with more than 50 newer spam transactions.

## 4. Bounded history (REC-L1)

- [x] 4.1 Add the overall history deadline, the median-head cross-check with tolerance, a common `to` block, and fail-fast on the page budget. Verify the hostile-head tests (multi-RPC and sole RPC) and the existing paging tests.

## 5. Distinct key material (REC-L2)

- [x] 5.1 Add the `duplicate-prf` case to `scripts/gen-vectors.py` (mirroring the check) and regenerate `v1.json`. Verify `gen-vectors.py --check` and that no existing case's bytes changed.
- [x] 5.2 Add the check to `createVault` in `src/vault.ts`, and update `docs/spec/vault-format-v1.md` with the create-validation order. Verify the vault-crypto tests, including the new vector.
- [x] 5.3 Mirror the check in `tools/recover/tests/support/writer.py` and re-pin `v1.json` in the recovery tool. Verify the recovery tool's vector tests.

## 6. Timeout (INFO)

- [x] 6.1 Reject non-finite or out-of-range `--timeout` values as a usage error. Verify the `inf`, `nan`, `0`, and `301` tests.

## 7. Docs and spec alignment

- [x] 7.1 Amend `add-desktop-recovery-tool`'s "Disagreeing chain sources" requirement to defer to this change (no version-based preference). Update the recovery README (exit code 12, trust model) and add a round-3 section to `docs/reviews/recovery-tool-v1.md`. Verify `openspec validate --strict` for both changes and the README command test.

## 8. Security review

- [ ] 8.1 Security review by `security-reviewer` of the whole diff. The checklist covers:
  - quorum counting (URL normalisation, distinct sources);
  - that ranking cannot be influenced by any single source;
  - tie handling showing no plaintext before the choice;
  - the Arweave per-server model and budgets;
  - the history deadline and head cross-check;
  - the `createVault` check and vector integrity.
  
  Verify all CRITICAL/HIGH findings are resolved and the result is recorded in `docs/reviews/harden-recovery-network-trust.md`.

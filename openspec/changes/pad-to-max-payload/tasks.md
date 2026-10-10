# Tasks

> Owners: **[cry]** applied-cryptography engineer, **[re]** recovery tool, **[fe]** frontend, **[sec]** security
> review. **TDD:** each test first, then the code.

## 1. Plan

- [x] 1.1 [cry] Proposal, design, spec deltas (`vault-crypto`, `vault-recovery`) and tasks. Verify: `openspec validate --all --strict`.

## 2. vault-crypto [cry]

- [x] 2.1 Tests first (`test/pad-to-max.test.ts`): blob length equals `overhead + 64 × floor((1024 − overhead) / 64)` for random RP IDs, 2..8 credential IDs of random lengths, both modes and two random secrets (property); create, update and add-key write the maximum for their key set; add-key re-pads to the N + 1 maximum and refuses `VAULT_TOO_LARGE` when the secret no longer fits; `pad` refuses a target that is too small or not a multiple of 64; `unit.test.ts` 5.1 expects 640 + 16. Verify: they fail.
- [x] 2.2 `pad(secret, target)` and `paddedLengthFor` (`padding.ts`, `format.ts`); `createVault`, `updatePayload`, `addKey` pad to the maximum (`vault.ts`). Verify: 2.1 passes.
- [x] 2.3 Vector tests first (`test/vectors.test.ts`): `lengthHidingCases`, `legacyPaddingCases`, `paddedLength`, `expectedBlobLength`, the new open cases. Verify: they fail on the old file.
- [x] 2.4 `scripts/gen-vectors.py`: maximum padding, the new vaults and sections, the legacy blobs generated with the old rule and SHA-256-pinned against the previous file. Regenerate `test-vectors/v1.json` and `docs/spec/payload-vectors.json`. Verify: `gen-vectors.py --check`, `gen-payload-vectors.py --check`, `pnpm --filter @cryoshield/vault-crypto test`.
- [x] 2.5 Spec `docs/spec/vault-format-v1.md` §6.1, §6.6, §6.7, §7, §11 and the amendment note; README. Verify: review against the vectors.
- [x] 2.6 Decoder compatibility: the unchanged TypeScript and Python decoders open the maximum-padded vectors and the legacy cases. Verify: vector tests in both suites.

## 3. Web app [fe]

- [x] 3.1 Test first (`test/vault/adapter.test.ts`): `createVaultBlob` with a 12-word and a 24-word seed gives equal blob lengths; `editVaultBlob` and `addKeyToBlob` write the maximum for their key set; Archive and clear keeps the length. Then no `src` change is needed (padding lives in vault-crypto). Verify: `pnpm --filter @cryoshield/web test`, typecheck, lint, verify-build.
- [ ] 3.2 E2E covering create, edit and add-key (chromium; mobile if feasible). Verify: Playwright.

## 4. Gas and cost [cry]

- [x] 4.1 Measure: forge snapshots for 526- and 974-byte create and update (`test/GasV2.t.sol`, `script/gas-md.sh`, `GAS.md`); the anvil full-stack 12-word / 24-word create and edit before and after (`test-int/gas.int.test.ts`); OP Mainnet fee readings. Verify: `forge test`, `script/gas-md.sh --check`, `pnpm --filter @cryoshield/web test:int`.
- [x] 4.2 `apps/web/docs/costs.md`: before/after cost per create and edit, the per-operation, per-user and global caps re-checked. Verify: review.

## 5. Recovery tool [re]

- [x] 5.1 Tests first: `tests/test_vectors.py` runs `lengthHidingCases` and `legacyPaddingCases`; the test-only writer (`tests/support/writer.py`) pads to the maximum; pins updated for `v1.json` and `payload-vectors.json`. The shipped decoder is unchanged. Verify: `uv run pytest -q`.

## 6. Security review [sec]

- [ ] 6.1 Review against the threat model in design.md: what padding hides and what stays public; AAD and nonce invariants unchanged; zero-pad and length-prefix checks in both decoders; no new oracle; F2 status. Record in design.md → Security review. Verify: no open CRITICAL or HIGH.

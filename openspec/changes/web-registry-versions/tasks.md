# Tasks

> Implements `recover-registry-versions` follow-up 7.2. Owners: **[fe]** frontend engineer, **[sec]** security reviewer.
> **TDD:** write each listed test first, see it fail, then implement.

## 1. Build config [fe]

- [x] 1.1 Test first (`test/build/registries.test.ts`, `test/build/deployment.test.ts`): the parser reads v1, v2 and a 3-registry fixture (a fake v3 under `contracts.vaultRegistries.v3` and under `contracts.vaultRegistryV3`, both with v2's `abiHash`), newest first with explicit ABI kinds; it refuses an unknown v3 `abiHash` ("update the app"), a missing `abiHash` on v3, a conflicting duplicate version, a duplicate address, a bad key, a non-object entry, a bad address or block, no registry, and a kind-1 newest registry. `loadDeployment` returns the list, and the Vite build fails on an unknown version. Then implement `vite-plugins/registries.mjs` and the `deployment.ts`/`cryoshield.ts` wiring (D1). Verify: vitest.

## 2. Reads and writes [fe]

- [x] 2.1 Test first (`test/chain/registry.test.ts`): with v3 (v2 ABI), v2 and v1: v3 > v2 > v1 for one id; a v1 id held by v3 under another locator; a v2 id held by v3; v3 unconfirmed fails the read (no v2/v1 fallback); a v1-only vault still opens; every existing v1 + v2 case unchanged. Then generalise `createRegistryReader` (D2). Verify: vitest.
- [x] 2.2 Test first: dates query every registry in the list (`test/chain/history.test.ts`); writes and the sponsor policy target the newest registry; vaults of any older registry are read-only (`operations`, list grouping). Then implement (D3). Verify: vitest, typecheck.

## 3. Release manifest and smoke test [fe]

- [x] 3.1 Test first (`deploy/test/release-manifest.test.ts`): `config.registries` newest first with `abiHash`, the legacy fields unchanged, a 3-registry record, and an unknown version refused. Then implement (D4). Verify: `pnpm test:deploy`.
- [x] 3.2 Test first (`.github/scripts/test/deploy-scripts.test.mjs`): `smoke.sh` accepts a valid `config.registries`; fails on a missing list, wrong order, duplicate version, v1/v2 mismatch with the record, a registry absent from `/architecture`, and a `REGISTRIES` mismatch; exits 2 on a malformed `REGISTRIES`. Then implement (D6). Verify: `node --test`.

## 4. Pages [fe]

- [x] 4.1 Test first: the architecture page lists every registry with its version (build freshness test and `e2e/specs/11-architecture.spec.ts`, both generic over the record), and `architectureValues` renders a 3-registry list; the vault-location panel shows "Version N" and "(read-only)" for an older registry. Then implement (D5). Verify: vitest, Playwright.

## 5. Checks [fe]

- [x] 5.1 Run unit, integration (after `forge build` and `FOUNDRY_PROFILE=v1 forge build`), E2E, typecheck, lint, `verify-build` (e2e and production; the `/app` initial JS must not exceed the unchanged baseline) and `openspec validate --all --strict`. Verify: all pass.

## 5b. ECC review of dc4cdd6 [fe]

- [x] 5b.1 HIGH: test first (`test/ui/create-v3.test.tsx`, v3 config fixture): a created vault is tagged with the newest registry (create, open writable, edit, mirror Retry naming v3). Then replace the `'v2'` literal in `saveNewVault` with `WRITE_REGISTRY.version`. Verify: vitest.
- [x] 5b.2 MEDIUM: test first: a `contracts` key starting with `vaultRegistry` that is not exactly `vaultRegistryV<N>` (or `vaultRegistries`) fails the build. Then implement. Verify: vitest.
- [x] 5b.3 MEDIUM: three-registry read tests: a malformed newer record, a `getVaults` row-count mismatch, an id in v2+v1 but not v3, more than 32 ids across registries, a middle registry with the v1 interface (`test/chain/registry.test.ts`), and a v3 vault through unlock and the vault list (`test/ui/vaults-v3.test.tsx`). Verify: vitest.
- [x] 5b.4 LOW: `release-manifest.mjs` takes the legacy v1/v2 fields from the parsed list (test first); design A3 (an ABI match is not a behaviour match); 6.1 made a release gate. Verify: `pnpm test:deploy`.

## 6. Follow-ups

- [ ] 6.1 [fe][sec] **Release gate: before any record lists a v3**, pass `REGISTRIES` (from the record) to `smoke.sh` in `deploy.yml` and `deploy-dev.yml`, with a reviewed digest update of `privileged-run-steps.json`. Until then a v3 is checked only for shape, order and presence on `/architecture`, not against the record. Verify: `deploy-workflow.test.mjs` asserts the env is set from the record, and `workflow-policy.mjs` passes.
- [ ] 6.2 [fe] Once the smoke test and the minimum supported recovery tool read `config.registries`, remove `config.registry`/`config.registryV2` from the release manifest.
- [ ] 6.3 [fe] Before any record lists a v3: the open items of `docs/reviews/web-registry-versions.md`. P1: wrap a single or oldest registry's own reads in `RegistryUnconfirmedError` (a `[v2]`-only test with a failing RPC). P3: chunk kind-1 `getVault` calls by `GET_VAULTS_MAX`. P4: a case-insensitive near-miss key guard. P5: require v2 in `registryList`, or make `registryV2` nullable. P7–P9: the tidy-ups. R2: move the paymaster provider's allowlist from v2 to v3 in the v3 release (`apps/web/docs/paymaster-policy.md`). Verify: vitest and `pnpm test:deploy`.

> 2026-10-08: 6.1 and 6.2 stay open. Both are gated on a v3 registry, and no record lists one yet.

## 7. Security review [sec]

- [x] 7.1 Review D2 (newest-authoritative, no fallback on an unconfirmed newer registry), D1 (unknown ABIs refused) and D6 against the threat model. Record in `docs/reviews/web-registry-versions.md` (beside the other review records, instead of `apps/web/docs/`). Verify: no open CRITICAL or HIGH findings.

  2026-10-08: recorded in `docs/reviews/web-registry-versions.md`. APPROVE, no open CRITICAL or HIGH. PR #54's MEDIUM copy finding is fixed. Still open: P1 (UX, fails closed), P3 (not reachable today) and the LOW items, tracked in 6.3. R1 (a consistently lying RPC can roll a vault back) is accepted as a pre-existing single-RPC residual.

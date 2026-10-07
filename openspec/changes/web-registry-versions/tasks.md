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

## 6. Follow-ups

- [ ] 6.1 [fe][sec] When v3 ships: pass `REGISTRIES` (from the record) to `smoke.sh` in `deploy.yml` and `deploy-dev.yml`, with a reviewed digest update of `privileged-run-steps.json`.
- [ ] 6.2 [fe] Once the smoke test and the minimum supported recovery tool read `config.registries`, remove `config.registry`/`config.registryV2` from the release manifest.

## 7. Security review [sec]

- [ ] 7.1 Review D2 (newest-authoritative, no fallback on an unconfirmed newer registry), D1 (unknown ABIs refused) and D6 against the threat model. Record in `apps/web/docs/security-review-registry-versions.md`. Verify: no open CRITICAL or HIGH findings.

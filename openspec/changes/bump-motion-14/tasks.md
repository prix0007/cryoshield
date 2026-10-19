# Tasks

## 1. Tests first

- [x] 1.1 `apps/web/test/build/motion-pin.test.ts`: the guardrail names `14.0.0` for `package.json` and the four
  lockfile entries. Fails on 13.5.0 (3 assertions).
- [x] 1.2 `apps/web/test/build/assets.test.ts` already derives the version from `package.json`; after the bump it
  fails until `docs/design/ASSETS.md` names `motion@14.0.0`.

## 2. Implementation

- [x] 2.1 `pnpm --filter @cryoshield/web add motion@14.0.0 --save-exact`: `package.json` and `pnpm-lock.yaml`
  (D1, D2).
- [x] 2.2 `docs/design/ASSETS.md`: version, dated grep of the 14.0.0 dists, usage column (D3).
- [x] 2.3 Spec delta for `app-motion`, "Lazy features and budget": exact, recorded, tested pin.

## 3. Verification

- [x] 3.1 `pnpm --filter @cryoshield/web test`, `lint`, `typecheck`, `verify-build`; `openspec validate --all
  --strict`.

  2026-10-19: the pin tests failed on 13.5.0 (3 failed, 1 passed), then passed after the bump; whole web suite
  103 files / 1,496 tests passed; eslint and tsc clean; `verify-build` PASS (reproducible build, `/app` +20,110 B
  of +20,480 B, landing 11.16 KB of 120 KB).

## 4. Review

- [x] 4.1 Security review recorded in `design.md` (supply chain, CSP grep, budgets).

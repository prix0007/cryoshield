# Tasks

## 1. Failing checks first

- [x] 1.1 Record the three failing checks on `main`: `pnpm audit --audit-level=moderate` (2 moderate,
  GHSA-p458-7748-mcp3), `npm audit --prefix .github/openspec-cli` (4 high via `braces`) and
  `node apps/web/scripts/beacon-drift.mjs` (exit 1, both hashes printed). Verify each exits non-zero.

  2026-10-22: exit 1, exit 1, exit 1 (committed `sha384-IJ+SAOzs…` vs live `sha384-DSBfgE0s…`).

## 2. Pins and records

- [x] 2.1 Vitest (D1): `pnpm --filter @cryoshield/web --filter @cryoshield/metrics add -D vitest@5.0.5 --save-exact`
  and `pnpm --filter @cryoshield/vault-crypto add -D vitest@5.0.5 @vitest/browser-playwright@5.0.5 --save-exact`.
  Verify the three `package.json` files and `pnpm-lock.yaml` name only 5.0.5 for `vitest` and every `@vitest/*`,
  `pnpm install --frozen-lockfile` succeeds, and `pnpm audit --audit-level=moderate` reports 0 vulnerabilities.

  2026-10-22: seven `@vitest/*` entries (browser-playwright, browser, mocker, pretty-format, spy, ui, utils) all at 5.0.5; frozen install clean; `pnpm audit`: "No known vulnerabilities".
- [x] 2.2 OpenSpec CLI (D2): set `@fission-ai/openspec` to `1.14.3` in `.github/openspec-cli/package.json` and run
  `npm install --ignore-scripts --package-lock-only --no-audit --no-fund --prefix .github/openspec-cli`. Verify the
  lockfile has no `braces`, `micromatch` or `fast-glob` entry, `npm ci --ignore-scripts --prefix .github/openspec-cli`
  succeeds and `npm audit --prefix .github/openspec-cli` reports 0 vulnerabilities.

  2026-10-22: done and verified (0 matches, `npm ci` ok, `found 0 vulnerabilities`), then **reverted** after 3.2: the
  pin stays at 1.14.0 (D2). No file under `.github/openspec-cli` changes in this PR.
- [x] 2.3 Exceptions (D2, D4): the `braces` entries stay in `.github/osv-scanner.toml` and `.github/trivyignore.yaml`;
  the TOML comment and the README row name the fix (1.14.3) and the blocker (84 over-long requirements); the README
  "As of" line is re-dated to 2026-10-22. Verify `npm test --prefix .github/scripts` passes and `trivy-gate.mjs`'s
  README mirror check still finds `CVE-2026-93687`.

  2026-10-22: 442/442; mirror check passes.
- [x] 2.4 Beacon (D3, D4): update `apps/web/analytics/beacon.lock.json` (`sha384`, `bytes`, `version`, `reviewedAt`,
  `reviewNotes`). Verify `node apps/web/scripts/beacon-drift.mjs` prints `ok   beacon unchanged` and exits 0.

  2026-10-22: `ok   beacon unchanged: sha384-DSBfgE0s… (ETag W/"2026.10.1", 31853 bytes)`, exit 0.

## 3. Verification

- [x] 3.1 `pnpm --filter @cryoshield/web test`, `lint`, `typecheck`, `verify-build`;
  `pnpm --filter @cryoshield/vault-crypto test` and `test:browser`; `pnpm --filter @cryoshield/metrics test` and
  `typecheck`. Verify all pass on 5.0.5, `verify-build` reports the beacon pinned to the lock, and the installed
  Vitest trees carry no `setup.mjs`, `Math_Symbol.js` or `preinstall` hook.

  2026-10-22: web 107 files / 1,563 tests, eslint and tsc clean, `verify-build` PASS ("beacon pinned to the lock",
  `/app` +20,265 B of +20,480 B); vault-crypto 17 files / 381 tests with typecheck, Browser Mode 10 files / 370 tests;
  metrics 8 files / 55 tests, tsc clean; marker scan: nothing. (Two vault-crypto Node failures seen first were the
  local `scripts/.venv` missing `pycryptodome`; `pip install -r scripts/requirements.txt` fixed the machine, not the
  repo.)
- [x] 3.2 `openspec validate --all --strict` with 1.14.3 (`.github/openspec-cli/node_modules/.bin/openspec`). Verify it
  is green; if 1.14.3 raises new warnings in existing changes, fix trivial ones here or hold the pin (design risk 2).

  2026-10-22: 17 passed, 32 failed, 84 warnings, all "Requirement text is very long (>500 characters)", 0 errors.
  Not trivial: pin held (D2). With 1.14.0 (CI's version) the whole tree validates strictly, including this change.
- [x] 3.3 Analytics E2E: `pnpm --filter @cryoshield/web exec playwright test --project analytics`. Verify it passes.

  2026-10-22: 9 passed (15.2 s), including "the beacon loads once with integrity" against the new lock.

## 4. Review

- [x] 4.1 Security review (design.md → "Security review"): results of 2.3 and 3.1–3.3 recorded; beacon diff review
  outcome recorded in D3 and in the lock's `reviewNotes`. Verify the table has no open row.

  2026-10-22: rows 1, 3, 4 Pass; row 2 Held (D2) with the follow-up named.

# Tasks

> Owner: **[fe]** frontend engineer. **TDD:** each test first, then the code.

## 1. Mobile E2E [fe]

- [x] 1.1 Projects (D1): `mobile` (Pixel 7) and `mobile-small` (360 px) in `playwright.config.ts`, with the D2 run list; `chromium` ignores `21-mobile`. Verify: `playwright test --list` shows the projects and the specs per project.
- [x] 1.2 Test first: `e2e/specs/21-mobile.spec.ts` with `phoneAudit` (D3) and the page, landing, support and vault-flow walks. Run it and record every failure. Verify: playwright (`--project=mobile --project=mobile-small`), failing on the defects.
  - Result (2026-10-09): 8/8 failing before fixes; the menu-under-sub-nav defect (D5.1) plus two test-tooling issues (closed `<details>`, disabled buttons). The full run on `mobile` then found D5.3 (axe in `08-legal`, `15-support`, `19-theme`); `phoneAudit` gained check 5 and failed on it at 360 px before the fix.

## 2. Fixes and checks [fe]

- [x] 2.1 Fix each defect from 1.2 with a minimal CSS/markup change in `apps/web` (CSP-safe: classes only, no inline styles); record before/after in design.md D5. Verify: `21-mobile` green on both phone projects; unit `test/legal/renderer-tables.test.ts` (written first, failed 3/3, then passed).
- [x] 2.2 Full E2E (all projects), unit tests, typecheck, lint, build, `verify-build`, `openspec validate --all --strict`; record pass counts and the added E2E time here. Docs: `apps/web/e2e/README.md` (projects). Verify: all pass.
  - Result (2026-10-09, local M-series Mac): E2E `chromium` + `analytics` 95 passed, 13 skipped (screenshot specs) in 4.1 min; `mobile` + `mobile-small` 76 passed in 6.0 min (72 on `mobile`, 4 on `mobile-small`). Unit 1,427/1,427 (98 files); typecheck and lint clean; `verify-build` PASS (reproducible production build, strict CSP in 8 pages); `openspec validate --all --strict` 37/37.
  - Added E2E time: about +6 min locally (4.1 → 10.1 min). The `web-e2e` job's 30-minute timeout is kept; no workflow change (`test:e2e` runs every project with the Chromium it already installs).

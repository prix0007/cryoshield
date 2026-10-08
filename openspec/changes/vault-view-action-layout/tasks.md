# Tasks

> Owner: **[fe]** frontend engineer. **TDD:** each test first, then the code.

## 1. Layout [fe]

- [x] 1.1 Tests first (`test/ui/vault-actions.test.tsx`): the three groups and their labels, rows as `<li><button>` under an h2 "Manage vault", the chevron aria-hidden, keyboard order (Edit secrets, rows, All vaults, Lock), read-only hiding (Details only), no All vaults without `onAllVaults`, each row opens its screen, axe. Then D1–D3 in `VaultView.tsx`, `strings.ts` and `global.css`. Verify: vitest.
- [x] 1.2 Update the unit tests and E2E specs that use the old labels ("Edit vault" on the vault screen, "Vault details" as a button). Verify: vitest, playwright.
- [x] 1.3 Docs: `apps/web/docs/hardware-test.md` (and any README or `docs/` mention of the vault screen's buttons). Verify: review.

## 2. Checks [fe]

- [x] 2.1 Unit, E2E (with `SCREENSHOTS=1`; light and dark screenshots of the new layout), typecheck, lint, `verify-build` (e2e and production, within the baseline; record the delta here) and `openspec validate --all --strict`. Verify: all pass.
  - Result (2026-10-08): unit 1,186/1,186 (85 files); E2E 73 passed, 10 skipped (screenshot specs; the new one run with `SCREENSHOTS=1`); typecheck and lint clean. /app initial JS gzip f2c70e4 -> this change: e2e 203,673 -> 203,832 B (+159 B), production 203,688 -> 203,841 B (+153 B); cap 203,905 B, so no baseline change (64 B headroom left).

## 3. ECC review [fe]

- [x] 3.1 M3: test first (`vault-actions.test.tsx`: one Lock, in the header, only while a vault is open; it locks; no Lock in the vault view). Then D5 (`SubNav` action, App, CSS) and the E2E selectors. Verify: vitest, playwright.
- [x] 3.2 L1, L4: tests (read-only rows; the list's accessible name is "Manage vault"). Then D6. Verify: vitest.
  - Result after review (2026-10-08): unit 1,187/1,187; E2E 73 passed, 10 skipped; typecheck, lint, `openspec validate --all --strict` clean. /app initial JS gzip e2e 203,870 B (+197 B over f2c70e4), production 203,881 B (+193 B); within the existing baseline (cap 203,905 B).

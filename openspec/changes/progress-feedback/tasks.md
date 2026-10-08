# Tasks

> Owner: **[fe]** frontend engineer. **TDD:** each test first, then the code.

## 1. The shared progress view [fe]

- [x] 1.1 Tests first (`test/ui/progress.test.tsx`): the progressbar attributes and value text, step states (done, current with spinner, todo), advance only when `done` changes, one polite announcement per step, failure (error mark, no spinner, not busy), complete, reassurance after 10 s with fake timers (reset on step change, never when failed), focus never moved, `Loading` hidden under 300 ms then spinner + text with `aria-busy`, reduced-motion CSS. Then D1, D3, D5 (`Progress`, `useAfter`, `Spinner`, `Loading`) in `motionkit.tsx`, strings and CSS. Verify: vitest.

## 2. Wiring [fe]

- [x] 2.1 Tests first (`test/ui/progress-flows.test.tsx`): edit and create steps driven by mocked `onProgress` (5 and 4 steps), the Arweave background line never delaying "Saved", failure keeps the stopped bar with the error, unlock steps appear only after 300 ms and follow `onPhase`. Then D2 and D4 in `CreateFlow`, `VaultView`, `UnlockFlow`, `App`, `VaultsMenu`, `chain/unlock.ts`. Update tests that quote the old checklist. Verify: vitest.
- [x] 2.2 Loaders (D5): the lazy fallbacks and the vault-row dates spinner. Verify: vitest.
- [x] 2.3 E2E selectors and a screenshot test (light and dark: a save mid-way, the unlock loader). Verify: playwright.

## 3. Checks [fe]

- [x] 3.1 Unit, E2E, typecheck, lint, `verify-build` (e2e and production; record the bundle numbers and any baseline change, dated, in design D6 and `scripts/verify-build.mjs`) and `openspec validate --all --strict`. Verify: all pass.
  - Result (2026-10-08): unit 1,203/1,203 (87 files); E2E 73 passed, 11 skipped (screenshot specs; the new one run with `SCREENSHOTS=1`); typecheck and lint clean; `openspec validate --all --strict` 34/34. /app initial JS gzip 74fc3c1 -> this change: e2e 203,832 -> 204,574 B (+742 B), production 203,841 -> 204,588 B (+747 B); baseline +1 KB (design D6), headroom 341 B.

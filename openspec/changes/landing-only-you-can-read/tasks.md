# Tasks

## 1. Tests first

- [x] 1.1 Update `test/landing/content.test.ts`:
  - the new section id and heading order;
  - the table structure (caption, column headers, four row headers and answers);
  - the fine-print disclaimer directly after the table;
  - no "stays on your device"/"never leaves your device";
  - no competitor names.

  Verify they fail before the markup.
- [x] 1.2 Extend `e2e/specs/05-landing.spec.ts`:
  - the tile and table render;
  - rows reveal (gain `.in`) after scrolling;
  - under reduced motion the rows are fully visible with no running animations;
  - axe on the tile in light and at 390 px;
  - no horizontal overflow at 390 px.

## 2. Build

- [x] 2.1 Add the tile to `index.html`, the reveal to `src/landing/boot.ts` (called from `main.ts`) and the styles to `landing.css`. Verify that 1.1/1.2 pass, and that `pnpm verify-build` (budgets) is green.
- [x] 2.2 Screenshots: the tile on desktop (revealed) and on a phone, plus updated full-page landing screenshots.

## 3. Review

- [x] 3.1 Accessibility note (table semantics, reduced motion, contrast, reflow). Record it in `apps/web/docs/a11y-review-only-you-can-read.md`.

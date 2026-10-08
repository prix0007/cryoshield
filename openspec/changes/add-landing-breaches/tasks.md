# Tasks

## 1. Tests first

- [x] 1.1 `test/landing/content.test.ts`: section id and H2 order include `breaches` / "Where backups leak."; the tile
  is a plain tile (no `data-scene`); three cards with labels, incidents, helps lines (aria-hidden check SVG) and source
  links (exact hrefs, `rel="noopener noreferrer"`, no `target`, name starts "Source:"); the honest-limit line; the CTA
  heading and two pills with hrefs; BANNED on the tile's text. Fails before 2.1.
- [x] 1.2 `e2e/specs/05-landing.spec.ts`: the tile renders between fragile and how, the source links are visible, and
  the "Seal it with your security key" pill opens `/app/`. Fails before 2.1.
- [x] 1.3 `e2e/specs/19-theme.spec.ts`: axe (colour contrast included) on `#breaches` in forced Light and forced Dark
  at 1280 and 390 px; at 390 px the cards share one column and the page has no horizontal scroll. Fails before 2.2.

## 2. Implementation

- [x] 2.1 `index.html`: the `#breaches` tile after `#fragile` (copy as vetted in design.md, sources linked).
- [x] 2.2 `src/landing/landing.css`: card grid (3 → 1 columns), card, check icon, helps line, honest limit and CTA
  styles from existing tokens only.

## 3. Verification and docs

- [x] 3.1 `pnpm typecheck`, `lint`, `vitest run`, `build`, `verify-build` (landing JS budget unchanged), CSP check;
  Playwright 05, 07, 12, 16, 19, 30 green.
- [x] 3.2 `90-screenshots.spec.ts`: a breaches test (light and dark, desktop and phone); regenerate the landing
  screenshots; describe them in `docs/screenshots/README.md`.
- [x] 3.3 Honesty and security review recorded in design.md (static HTML/CSS, CSP unchanged, copy vs sources).

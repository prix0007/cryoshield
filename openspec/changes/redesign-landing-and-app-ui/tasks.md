# Tasks

## 1. Dependencies, assets and tokens

- [x] 1.1 Add `motion@13.5.0` (exact pin) to `apps/web` dependencies. Vendor `inter-latin-wght-normal.woff2` from `@fontsource-variable/inter@5.3.0` into `src/ui/fonts/` together with `OFL.txt`. Write `docs/design/ASSETS.md` (each item's source URL, version, license and SHA-256). Verify with `pnpm install --frozen-lockfile` and a unit test that the woff2's SHA-256 matches ASSETS.md.
- [x] 1.2 Write a failing `test/ui/tokens.test.ts`:
  - it parses `src/ui/tokens.css`;
  - every declared text pair is ≥ 4.5:1 and every boundary pair is ≥ 3:1, in light and dark;
  - no colour literal appears outside the token file;
  - no `font-weight: 500`;
  - every `@font-face` src is relative.

  Then write `tokens.css` until it passes.

## 2. Routing and build plumbing

- [ ] 2.1 Write failing tests, then implement:
  - `test/build/pages.test.ts` (a production build has `index.html` and `app/index.html` with identical CSP metas and no inline script/style; the app page loads the React entry and the landing page does not);
  - `vite.config.ts` multi-page input;
  - move the app to `app/index.html`.
- [ ] 2.2 Extend `scripts/verify-build.mjs`:
  - check the CSP on every HTML page, and require it to be identical across pages;
  - enforce the landing JS budget (initial ≤ 6 KB, each lazy chunk ≤ 10 KB, total ≤ 16 KB gzip; no React/viem markers), printing the measured sizes.

  Verify that `pnpm verify-build` passes, and that it fails when the budget is temporarily lowered (`VERIFY_LANDING_BUDGET_SCALE=0.01`).
- [ ] 2.3 Write failing gen-context tests (CSP mismatch between pages is refused; `/app/` and `/app/index.html` are no-cache), then implement them in `deploy/gen-context.mjs`. Verify with `pnpm test:deploy -- gen-context`.
- [ ] 2.4 Extend `deploy/test/container.test.ts`:
  - `/app/` → 200 with every header and no-cache;
  - `/app` → redirect to `/app/` on the same host;
  - `/app/index.html` → no-cache;
  - `/app/nope` → 404 with headers;
  - the landing page and the app have the same CSP header.

  Verify with `pnpm test:deploy` (Docker). Update `deploy/README.md` with the routes and the post-deploy curl checks.

## 3. Landing page

- [ ] 3.1 Write failing `test/landing/content.test.ts` against `index.html`:
  - the tile order and headings;
  - 1–2 pill CTAs per story tile;
  - the required disclosures (OP Sepolia, unaudited, all keys lost);
  - the overclaim denylist;
  - no Apple names;
  - footer links (GitHub, recovery docs, license);
  - one `h1`, a skip link, and landmarks.

  Then write the static landing markup and first-party SVG graphics until it passes.
- [ ] 3.2 Write a failing `test/landing/main.test.ts` (jsdom):
  - under reduced motion, the motion module is never imported;
  - otherwise it is imported only after a graphic intersects;
  - an import failure leaves the page static with no thrown error.

  Then implement `src/landing/main.ts` and `src/landing/motion.ts` (`motion/mini` animate + `scroll` + `inView`).
- [ ] 3.3 Write `src/landing/landing.css` (tiles, global nav with `<details>` menu ≤ 833px, frosted sub-nav, hero CSS animation, reduced-motion overrides, responsive hero sizes). Verify with E2E 3.4.
- [ ] 3.4 Add `e2e/specs/05-landing.spec.ts` covering:
  - render and the disclosures;
  - axe at 1280px and 375px;
  - keyboard Tab reaches "Open the app" and every footer link, with a visible focus ring;
  - reduced motion: no motion chunk requested, end-state graphics;
  - lazy motion chunk requested only after scrolling;
  - CSP blocks injected inline script and `innerHTML`;
  - `/app/` link works.

  Verify with `pnpm test:e2e -- 05-landing`.

## 4. App restyle

- [ ] 4.1 Write failing unit tests in `test/ui/components.test.tsx`:
  - `GlobalNav` (link to `/`, menu summary ≥ 44px class, landmark);
  - `SubNav` (surface name, Testnet chip);
  - `ActionBar` (keeps children in order);
  - `Notice` (icon, title, `role=alert` for errors);
  - `noticeTitle` mapping for every key error message;
  - `KeyPrompt` ceremony (state label, live region, Continue);
  - `EmptyState`.

  Implement the components until they pass.
- [ ] 4.2 Apply the components and classes to `App`, `CreateFlow`, `UnlockFlow` and `VaultView`, with no logic or message changes. Add the secrets-editor `aria-invalid` on over-capacity, and the empty-vault state. Verify that all existing unit tests pass unchanged (except for new assertions), plus a new test for the over-capacity `aria-invalid` and the empty vault.
- [ ] 4.3 Rewrite `src/ui/global.css` on the tokens:
  - 17px body;
  - pills with `scale(0.95)`;
  - cards;
  - the sticky bar with `scroll-padding-bottom`;
  - focus rings;
  - the dark theme;
  - the reduced-motion overrides.

  Verify with the axe unit test (contrast enabled for the tokens test) and the E2E 4.4.
- [ ] 4.4 Update the E2E fixtures and specs for `/app/`. In `30-a11y.spec.ts`, raise the target check to 44×44 for buttons, inputs and standalone links, and add a sticky-bar focus-not-obscured check on a short viewport. Verify that the full `pnpm test:e2e` passes.

## 5. Screenshots and docs

- [ ] 5.1 Capture headless Playwright screenshots of the landing page (desktop, phone, reduced motion) and the app home/unlock/error states into `apps/web/docs/screenshots/`. Verify that the files exist.

## 6. Reviews

- [ ] 6.1 Security review:
  - the CSP is unchanged and identical on both pages;
  - TT/eval/innerHTML/WASM are absent from the bundle (grep plus the E2E injection test);
  - Motion supply-chain pinning;
  - no new origins in the E2E network allowlist;
  - the landing page loads no vault code;
  - the vault invariants hold (UV, zeroization, idle wipe, chain guard, clipboard) with their tests unchanged and green;
  - external links are safe.

  Record it in `apps/web/docs/security-review-ui-redesign.md`, and verify that every CRITICAL/HIGH finding is resolved.
- [ ] 6.2 Accessibility review (WCAG 2.2 AA):
  - the contrast table;
  - focus visible and not obscured;
  - target size;
  - reduced motion;
  - keyboard paths on the landing page and the app;
  - live regions in ceremonies;
  - reflow at 320px.

  Record it in `apps/web/docs/a11y-review-ui-redesign.md`, and verify that every blocking finding is fixed with axe E2E green.

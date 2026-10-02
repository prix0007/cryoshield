# Tasks

## 1. Hover bug

- [x] 1.1 Write a failing E2E `e2e/specs/06-hover.spec.ts` that hovers the logo, every global-nav link, every footer link and every pill on `/`, and the logo, nav links and buttons on `/app/`, then asserts the computed `text-decoration-line` is `none`, and that inline body-copy links are `underline` at rest. Fix `chrome.css` and `landing.css` (D6). Verify the spec passes.

## 2. Content and structure

- [ ] 2.1 Update `test/landing/content.test.ts` for the new section order and CTAs, the numbers band (final values in HTML), the permanence-caveat text and the denylist ("guaranteed", "forever", "unbreakable", "never lose"), and the existing disclosures. Then rewrite `index.html` with the hero, numbers band, six scenes, Free to use, final CTA, FAQ and footer. Verify with the unit test.

## 3. Scene runtime and scenes

- [ ] 3.1 Write failing unit tests `test/landing/scenes.test.ts`:
  - the `range(p, a, b)` clamp maths;
  - the year counter maps `p` to 2026..2036 and 2026..2126;
  - the ciphertext scramble is deterministic per `p` and ends fully hex;
  - the runtime writes `--p` and calls `update`;
  - the loader imports a scene's module only when it intersects, and never under reduced motion.

  Implement `src/landing/scenes/{runtime,fragile,tap,chain,lose,survive,timeline}.ts` and the loader in `boot.ts`.
- [ ] 3.2 Write the scene, hero, numbers and final-CTA styles in `landing.css`:
  - sticky stages, `--p` choreography, kinetic hero, docking key;
  - reduced-motion static key frames;
  - mobile simplifications.

  Verify with E2E 4.1.
- [ ] 3.3 Implement the number counters and the magnetic CTAs in `main.ts`, with a unit test for the counter formatting and for the magnetic effect being skipped on coarse pointers or reduced motion.

## 4. Verification

- [ ] 4.1 Add `e2e/specs/07-scenes.spec.ts`:
  - for each scene, scroll to 10% and 90% of its track and assert that the scene's `--p` and a visual property change while the heading stays visible;
  - reduced motion: no scene/motion chunks, no sticky stages, all text visible;
  - keyboard paging reaches the footer;
  - phone viewport touch-scroll reaches the footer;
  - axe at desktop and phone;
  - no CSP/TT violations or page errors while every scene runs.
- [ ] 4.2 Raise the budgets in `scripts/verify-build.mjs` (initial ≤ 15 KB, lazy ≤ 40 KB each, total ≤ 120 KB gzip) and add a sink grep (`innerHTML`, `insertAdjacentHTML`, `document.write`, `eval(`, `new Function`, `WebAssembly`) over the landing graph. Verify that `pnpm verify-build` passes and fails with `VERIFY_LANDING_BUDGET_SCALE=0.01`.
- [ ] 4.3 Run Lighthouse (mobile preset with simulated slow-4G/Fast-3G-class throttling, 3 runs, median) against `vite preview` of the production build. Record LCP, CLS, TBT and the score in `apps/web/docs/lighthouse-landing.md`. Verify CLS = 0 and LCP < 2.5 s.
- [ ] 4.4 Regenerate the screenshots (scene stills at key progress values, reduced motion, phone) with a short description in `apps/web/docs/screenshots/README.md`. Verify that the files exist.
- [ ] 4.5 Run every suite (unit, lint, typecheck, verify-build, E2E, integration, deploy/container) and verify they all pass.

## 5. Reviews

- [ ] 5.1 Security review:
  - CSP unchanged;
  - landing sink grep;
  - no new origins or dependencies;
  - `/app/` free of landing code;
  - honest-copy enforcement.

  Record it in `apps/web/docs/security-review-cinematic-landing.md`, and verify that there are no open CRITICAL/HIGH findings.
- [ ] 5.2 Accessibility review:
  - reduced motion;
  - flashing (≤ 3/s);
  - no scroll traps;
  - focus visible and not obscured by sticky stages;
  - text contrast over scene visuals;
  - axe;
  - keyboard;
  - 320px reflow.

  Record it in `apps/web/docs/a11y-review-cinematic-landing.md`, and verify that there are no blocking findings.

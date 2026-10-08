# Tasks

> **Archive after:** add-privacy-and-compliance (see the proposal).

## 1. Tests first

- [x] 1.1 `test/theme/theme-init.test.ts` (jsdom, runs the real script text, both the source and the minified bytes
  the build ships): applies a saved `dark`/`light` before the body; ignores an invalid value; falls back to System when
  `getItem` throws; a `change` on `select[data-theme-select]` applies, saves, syncs every switch, and System removes
  the key; `setItem` throwing still applies the theme; DOMContentLoaded sets each switch's value and unhides
  `[data-theme-switch]`; a `storage` event re-applies; no HTML sink, other storage or network API. Failed before 2.1.
- [x] 1.2 `test/build/theme-plugin.test.ts`: the plugin injects one `<script src="/assets/theme-<hash>.js">` at the end
  of `<head>` (after the CSP meta position), emits the minified asset named by its content hash. Failed before 2.2.
- [x] 1.3 `test/ui/tokens.test.ts`: dark tokens read from `:root[data-theme='dark']`; the media block
  (`:root:not([data-theme='light'])`) declares the same properties and values; `color-scheme` per theme; page-token
  pairs (text ≥ 4.5, boundaries ≥ 3) in light and dark; `--color-primary-fill` with `--on-primary` in both. Failed
  before 2.3 (38 failures).
- [x] 1.4 `test/ui/theme-switch.test.tsx` (RTL): the app's GlobalNav renders a "Theme" combobox with System, Light
  and Dark, its default value follows `<html data-theme>`, and the static header partial and landing header carry the
  same markup (hidden until the script runs). Failed before 2.4.
- [x] 1.5 `test/build/legal-checks.test.ts`, `test/legal/pages.test.ts`, `renderer-markers.test.ts`:
  `storageApiOutsideAllowedFiles` flags `localStorage` outside the theme asset and unlisted APIs; the `/cookies`
  preferences table; the cookie and privacy pages name `cryoshield-theme` and no longer say nothing is stored; legal,
  `/devices` and `/architecture` load only the theme script (also `deploy/test/container.test.ts`). Failed before 3.x.
- [x] 1.6 E2E `e2e/specs/19-theme.spec.ts`: the switch on every page (320, 390 and 1280 px, 44 px, no horizontal
  scroll); keyboard; choice applied and persisted across pages; restored before paint (`data-theme` already set when
  `<body>` is inserted, via an init-script MutationObserver); System follows `emulateMedia` and a forced choice beats
  it; storage throwing falls back safely; a tampered value is ignored; nothing is sent; axe (colour contrast included)
  in forced Light and forced Dark on every public page (and the landing at 390 px scrolled through its scenes), the
  app home, the saved screen, an open vault, the vault list and the editor. `08-legal.spec.ts`: the Dark/System sweep
  per route.

## 2. Theme script and tokens

- [x] 2.1 `src/theme/theme-init.js` (D1). 1.1 passes.
- [x] 2.2 `vite-plugins/theme.ts` + `vite.config.ts`. 1.2 passes; CSP checks pass.
- [x] 2.3 Tokens (D2, D3): `tokens.css` forced/system blocks and page tokens; `chrome.css` fills; `landing.css`,
  `legal.css`, `support.css`, `architecture.css` light-surface mapping; the fixed `color-scheme: light` removed.
  1.3 and the existing token tests pass.
- [x] 2.4 The switch markup and styles (D4): `chrome.tsx` (GlobalNav), `index.html`, `legal/partials/header.html`,
  `chrome.css`. 1.4 passes.

## 3. Privacy disclosure and guards

- [x] 3.1 `legal/storage-inventory.json` (`apis`, `apiFiles`, `preferences`) and the preferences table in
  `vite-plugins/legal.ts` (new `<!--storage-preferences-->` marker).
- [x] 3.2 `scripts/legal-check.mjs` `storageApiOutsideAllowedFiles` and its use in `scripts/verify-build.mjs` (plus:
  every page has exactly one theme script; the theme script may be shared by `/` and `/app/`; `/app` baseline +1 KB,
  measured and recorded in verify-build).
- [x] 3.3 Copy: `legal/cookies.md`, `legal/privacy.md` (new "On your device" section), the `/cookies` meta
  description; effective dates "2026-10-08 (revision 2)" and changelog entries. Compliance records updated:
  `docs/compliance/data-inventory.md`, `erasure-procedure.md`, `legal-analysis.md`.
- [x] 3.4 Lint: `eslint.config.js` stays unchanged (config-protection hook; design D5); the theme script's API
  surface is pinned by 1.1 and its storage by 3.2. 1.5 passes and `pnpm lint` is green.

## 4. Verification

- [x] 4.1 `pnpm typecheck`, `pnpm lint`, `pnpm vitest run` (1316 passed), `pnpm build` (with production-like env;
  the worktree has no `.env`), `pnpm verify-build` (PASS), `pnpm test:deploy` (120 passed; the 2
  `verify-real-env` tests need the real `apps/web/.env`, absent in this worktree, unrelated to this change).
- [x] 4.2 Playwright (chromium): 00, 05, 06, 07, 08, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20, 30, 40: 75 passed;
  analytics project: 9 passed.
- [x] 4.3 Light and dark screenshots of the switch and of the pages that gained a dark look
  (`90-screenshots.spec.ts`, `docs/screenshots/theme-*.png`).
- [x] 4.4 `openspec validate --all --strict`.

## 5. Reviews

- [ ] 5.1 ECC accessibility review (contrast and the switch, both themes) against the diff. **Not run:** the
  implementing agent had no Agent tool to launch `ecc:a11y-architect`; the overwatcher should run it. A self-audit
  was done instead (below).
- [ ] 5.2 ECC code review. **Not run** for the same reason; the PR's ECC review gate will also review it.
- [x] 5.3 Security review recorded in design.md ("Security review"): non-secret preference storage, CSP, guards.

### Self-audit (contrast and accessibility), both themes

Fixed:
- Filled pills and the skip link would have been white on `#2997ff` (2.9:1) in dark: new `--color-primary-fill`
  (`#0066cc`, 5.57:1) in both themes; its edge is ≥ 3:1 on both dark page surfaces.
- At 320 px the wordmark glyph was squeezed to a dot by the switch: `flex: none` (screenshot check).
- Forced-colours mode drops the switch's inset outline: a real 1px `ButtonText` border there.
- The architecture page's own `color-scheme: light dark` on `<body>` would have overridden a forced Light for native
  controls: removed (the root decides).

Checked, no change needed: every page/app text pair ≥ 4.5:1 and boundary ≥ 3:1 in both themes (unit test); axe clean
in forced Light and Dark on all public pages, the landing scenes scrolled through, and the app screens; the landing's
light scenes (tap, survive) and hero illustration remain legible in dark (screenshots); the QR code keeps its white
quiet zone.

Deferred (not blocking AA):
- `theme-color` metas still follow the device, not a forced choice (browser chrome colour only).
- In dark, the "Free to use" parchment tile, the black final CTA and the FAQ are close in tone (`#1d1d1f`, `#000`,
  `#000`); sections are separated by headings, not colour.
- The select's accessible name is "Theme" and its visible text is the current value (System/Light/Dark), the native
  pattern; no visible "Theme" text, an icon conveys it.

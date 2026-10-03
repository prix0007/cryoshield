# Tasks

## 1. Tests first

- [x] 1.1 Write failing `test/build/icons.test.ts`:
  - every file exists with the right dimensions (PNG IHDR; ICO directory has 16/32/48);
  - the apple-touch icon is fully opaque;
  - `favicon.svg` is safe (no script, handlers, foreignObject, href, `url(`, `@import`) and has a dark-mode rule;
  - the manifest fields, with colours matching `tokens.css`, and icons that exist;
  - the SHA-256 values match `brand/icons.sha256`.
- [x] 1.2 Extend `test/build/pages.test.ts` (built pages): every page links both icons, the apple-touch icon and the manifest, and has the two `theme-color` metas. Extend `deploy/test/container.test.ts`: `/favicon.ico`, `/favicon.svg` and `/site.webmanifest` return 200 with the right content types and every security header.

## 2. Design and generation

- [x] 2.1 Draw `apps/web/brand/{favicon,tile,maskable}.svg` (D1) and write `apps/web/scripts/build-icons.mjs` (D2), with `pnpm icons` to regenerate. Generate the binaries and `brand/icons.sha256`. Verify that 1.1 passes.
- [x] 2.2 Add the head tags to the five HTML shells (replacing `data:,`), add `site.webmanifest`, and set the manifest content type in `deploy/gen-context.mjs`. Verify that 1.2 passes and `pnpm verify-build` is green.
- [x] 2.3 Screenshots: browser tabs in light and dark, and the icon at 16, 32 and 180 px, in `apps/web/docs/screenshots/` with README entries.

## 3. Reviews

- [x] 3.1 Security review: the SVGs have no scripts, handlers or external references; the CSP is unchanged; the generator runs locally only and pulls nothing from the network; no new dependency. Record it in `apps/web/docs/security-review-brand-icon.md`.
- [x] 3.2 Accessibility note: the icons are decorative (the pages keep text titles); check the mark's contrast against light and dark browser chrome (≥ 3:1 for the shield against the tab background). Record it in the same file.

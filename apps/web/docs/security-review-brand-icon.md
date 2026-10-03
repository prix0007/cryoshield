# Security review and accessibility note: add-brand-icon

- **Date:** 2026-10-03
- **Reviewer:** frontend-engineer (self-review)

**Verdict: APPROVED.**

## Security (task 3.1)

| Check | Evidence | Result |
|---|---|---|
| SVGs contain no active content | The three SVG sources are hand-written. They have no `<script>`, no `on*` handlers, no `foreignObject`, no `href`/`xlink:href`, no `url(`, no `@import`, no DOCTYPE or ENTITY (unit test on `public/favicon.svg` and every `brand/*.svg`). The only `<style>` is a colour swap for `prefers-color-scheme: dark`. Browsers render favicons as isolated images anyway, with no script execution and no external loads. | Pass |
| CSP unchanged | Icons load under the existing `img-src 'self'`, and the manifest under the existing `manifest-src 'self'`. verify-build is green, and its no-other-origin check covers the new `<link>` tags (all root-relative). | Pass |
| Served safely | The container test shows `/favicon.ico`, `/favicon.svg`, `/apple-touch-icon.png` and `/site.webmanifest` served with the right content types (the manifest as `application/manifest+json` via a Caddy rule), every security header, and no `Server` header. `nosniff` applies. | Pass |
| No new dependency or network | `scripts/build-icons.mjs` uses the already-pinned `@playwright/test` Chromium, renders local SVG strings through `setContent`, and fetches nothing. It runs only on a maintainer's machine; the build and CI just use the committed outputs. | Pass |
| Integrity | `brand/icons.sha256` records every generated binary, and a test fails if a file no longer matches. Two consecutive generator runs produced byte-identical files. | Pass |
| Manifest scope | `start_url` `/app/`, `scope` `/`, `display` `standalone`. There is no service worker, so the device-storage inventory (none on every route) is unchanged. | Pass |

## Accessibility note (task 3.2)

- **Decorative only:** the icons carry no information the page lacks. Every page keeps its text `<title>` ("Your vault ·
  CryoShield", …), and screen readers announce the title, not the icon.
- **Contrast of the mark against browser chrome** (non-text, ≥ 3:1 target):
  - light mode: Action Blue `#0066cc` vs white tab 5.57:1, vs a grey tab strip `#dee1e6` 4.25:1;
  - dark mode: `#2997ff` vs `#202124` 5.34:1, vs `#35363a` 4.0:1;
  - the white snowflake inside the shield: 5.57:1 (light) and 3.02:1 (dark).
- **Legibility at 16 px:** a dedicated small drawing (shield fills the frame, heavier strokes kept clear of the edge).
  See `docs/screenshots/brand-icon-sizes.png` and the tab mocks.

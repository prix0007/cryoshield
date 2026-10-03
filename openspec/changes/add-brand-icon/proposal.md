# Proposal

## Why

The founder: "we have no title bar icon in app or main site, build and design one." Every page currently declares an
empty `data:,` icon, so browser tabs, bookmarks, home-screen shortcuts and installed-app tiles show a generic
placeholder. The brand already has a mark: the shield glyph in the global nav. The icon should be that same mark.

## What Changes

- **A brand mark** derived from the nav shield: a shield with the "cryo" snowflake (asterisk) motif, in the single
  Action Blue accent, with no gradients (`docs/design/visual-language.md`).
  - **Small mark** (`favicon.svg`, 16–48 px): the shield fills the frame and the strokes are heavier, so it reads at
    16×16. It adapts to dark mode with an inline `@media (prefers-color-scheme: dark)` style. No scripts, no external
    references.
  - **Tile mark** (app icons): a white shield on an opaque Action Blue square, plus a maskable variant with the mark
    inside the 80% safe zone.
- **Assets, all self-hosted under `'self'`:**
  - `favicon.svg`;
  - `favicon.ico` (16, 32, 48 px);
  - `apple-touch-icon.png` (180 px, opaque);
  - `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`;
  - `site.webmanifest` (name, short name, theme/background colours from the tokens, the icons, `start_url` `/app/`).
- **Every page** (`/`, `/app/`, `/privacy`, `/terms`, `/cookies`) links the icons and the manifest and carries
  `theme-color` for light and dark.
- **Reproducible rasters:** `apps/web/scripts/build-icons.mjs` renders the PNGs and assembles the ICO from the
  committed SVG sources. It uses the already-pinned `@playwright/test` Chromium, so there is no new dependency and no
  install script. A small ICO writer lives in the script itself. The outputs' SHA-256 values are committed, and a
  test checks them.
- **Caddy** serves `.webmanifest` as `application/manifest+json`.

**Out of scope:** a full logo or wordmark redesign; service workers or offline install (still none, per the storage
inventory); any CSP change (`img-src 'self'` and `manifest-src 'self'` already cover this).

**Runtime dependencies:** none, and no new origin.

## Capabilities

### New Capabilities
- `brand-icon`: the site's icon set and web app manifest. Covers the mark, sizes, light/dark behaviour, linking on
  every page, safe SVG content, and reproducible generation.

### Modified Capabilities
None.

## Impact

- New files:
  - `apps/web/brand/*.svg` (sources);
  - `apps/web/public/{favicon.svg,favicon.ico,apple-touch-icon.png,icon-192.png,icon-512.png,icon-maskable-512.png,site.webmanifest}`;
  - `apps/web/scripts/build-icons.mjs`.
- Changed files:
  - the five HTML shells;
  - the legal header partial (the nav glyph stays the same mark);
  - `deploy/gen-context.mjs` (manifest content type).
- Tests: build, unit and container. Screenshots are added.

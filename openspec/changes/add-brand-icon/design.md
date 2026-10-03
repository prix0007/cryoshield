# Design

## Context

- **Nav glyph:** `<svg viewBox="0 0 24 24">` with the shield path `M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z`
  filled white on the black nav, and a snowflake of three strokes (`M12 7v10 M7.7 9.5l8.6 5 M7.7 14.5l8.6-5`, width
  1.6).
- **CSP:** `img-src 'self' data:` and `manifest-src 'self'` already allow same-origin icons and a manifest. No CSP
  change is needed.
- **Pages:** every page currently declares `<link rel="icon" href="data:,">` to avoid a 404.

## Decisions

### D1. One mark, two drawings
- **Small mark** (`brand/favicon.svg`, served as `favicon.svg`, rasterised for the ICO):
  - viewBox `0 0 32 32`; the shield scaled up to fill the frame (≈1.5 px margin at 16 px);
  - snowflake strokes 3.4 units (≈1.7 px at 16 px) with round caps, and the spokes shortened so they never touch the
    shield edge (a 16 px render keeps one clear pixel of blue around the flake);
  - light mode: shield `#0066cc` (Action Blue), flake `#ffffff`;
  - dark mode: shield `#2997ff` (Sky Link Blue, the guide's accent-on-dark), flake `#ffffff`.
- **Tile mark** (`brand/tile.svg`, `brand/maskable.svg`): an opaque Action Blue square with a white shield and an
  Action Blue flake cut-out. This is the nav glyph inverted onto the accent, which reads as the same brand.
  - `tile.svg` keeps the shield at ~64% of the tile;
  - `maskable.svg` keeps it inside the central 80% circle (Android adaptive icons crop up to 20%), at ~46%.
- **No gradients, no shadows, a single accent:** per the guide.

### D2. Rasterising without a new dependency
- **Renderer:** `scripts/build-icons.mjs` launches the Chromium that `@playwright/test@1.63.0` already pins (installed
  for E2E). For each target it loads the SVG at that exact CSS pixel size with `deviceScaleFactor: 1`, and takes a
  PNG screenshot (transparent background for the favicon sizes, opaque for the tiles).
- **ICO:** the ICO file is a 6-byte header plus 16-byte directory entries, with PNG-compressed images
  (Vista+ format), written by ~25 lines in the script.
- **Integrity:** the script writes `brand/icons.sha256`, and `test/build/icons.test.ts` re-hashes the committed files.
- **Rejected:**
  - `sharp` brings native libvips binaries and a larger supply chain;
  - `@resvg/resvg-js` is a new dependency with per-platform binaries.

  Playwright is already trusted, pinned and present.
- **Reproducibility:** the same Chromium build gives the same pixels. If a Playwright bump changes them, the hash test
  flags it and the maintainer re-runs the script.

### D3. Head tags and manifest
Every page gets:
```html
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
```
- **Manifest values:**
  - `theme_color` `#000000` (the global nav);
  - `background_color` `#f5f5f7` (the app canvas, `--app-bg`);
  - `display` `standalone`;
  - `start_url` `/app/`, `scope` `/`.

  Tokens are the single source, and a test reads `tokens.css`.
- **No service worker:** installing is a home-screen shortcut only. The device-storage inventory is unchanged.

### D4. Serving
- `public/` files are copied to the site root by Vite and served by Caddy `file_server`.
- `.webmanifest` has no entry in Go's MIME table, so the generated Caddyfile sets `Content-Type
  application/manifest+json` for `/site.webmanifest`.
- `.ico` and `.svg` use Caddy's defaults (`image/vnd.microsoft.icon` / `image/x-icon`, and `image/svg+xml`). The
  container test pins the served values.

## Risks / Trade-offs

- **[16 px legibility]** → a dedicated small drawing with heavy strokes, checked at 16, 32 and 180 px in screenshots.
- **[SVG as an attack surface]** → hand-written, no scripts, no external references; a test enforces it, and the
  served CSP still applies to the document.
- **[Rendering drift on a Playwright upgrade]** → the hash test catches it; re-run the script.

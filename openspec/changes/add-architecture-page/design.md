# Design

## Context

- **Legal pages:** these are static shells (`privacy/index.html`, …) with `<!--partial:header-->`/`footer` markers
  that a pre-transform plugin fills, and a CSS file linked from the HTML (no JS). Caddy rewrites the exact clean paths
  to `<path>/index.html`, and `gen-context` requires every non-landing page to carry the app CSP.
- **The artifact:** `scratchpad/cryoshield-system-map.html`, written by the overwatcher. It has a `<style>` block with
  its own palette, `fill="var(--bg)"`/`var(--accent…)` inside SVG attributes, and marker ids `ar`, `ar2`, `ar3`.

## Decisions

### D1. Static shell, same plumbing as the legal pages
- **Shell:** `architecture/index.html` uses `<!--partial:header:System design-->` (the partial now takes an optional
  sub-nav name; the default is "Legal") and `<!--partial:footer-->`, and links `/src/architecture/architecture.css`.
- **Plumbing:** it is a Vite input. Caddy's clean-URL rewrite and `no-cache` list gain `/architecture`. The dev and
  preview rewrite gains it too. `gen-context`'s app-CSP page list and verify-build's analytics-confinement list include
  it.

### D2. Colours: the app's themed tokens
- **Mapping:** the page uses the `--app-*` tokens, which already switch with `prefers-color-scheme` and are
  contrast-tested:
  - page = `--app-surface`;
  - figure tile = `--app-bg`;
  - text = `--app-ink`, muted = `--app-muted`, lines = `--app-hairline`;
  - accent = `--app-link` (Action Blue, or Sky Link Blue on dark).
- **New token:** one, `--app-accent-soft` (accent at 10% light / 14% dark) for the highlighted boxes. It is defined
  in `tokens.css` with its dark value.
- **Chrome in dark mode:** the sub-nav and footer get dark-mode overrides on this page, so the whole page follows the
  scheme. The nav is black in both.
- **SVG:**
  - `fill="var(--bg)"` becomes `class="arch-box"`;
  - highlight rects become `class="arch-hl"`;
  - accent text becomes `class="arch-hl-text"`;
  - `currentColor` stays, and the SVG's `color` comes from CSS;
  - CSS rules beat presentation attributes, so no attribute carries `var()`.

### D3. Build-time values
- **Tokens:** the shell contains `__CS_NETWORK__`, `__CS_CHAIN_ID__`, `__CS_REGISTRY__`, `__CS_DEPLOY_BLOCK__` and
  `__CS_RP_ID__`. The `cryoshield` plugin, which already loads the deployment record and the config, replaces them in
  its HTML transform for this page.
- **Network names:** from a small map (11155420 → OP Sepolia, 10 → OP Mainnet, 31337 → local test chain); an unknown
  chain fails the build.
- **Freshness test:** the build test reads `contracts/deployments/<chainId>.json` and `.env.<mode>` and asserts the
  values on the page.

### D4. Wide figures
- Each SVG keeps `min-width: 720px` inside `.arch-scroll { overflow-x: auto }`. The container is `tabindex="0"` with
  `aria-labelledby` its figcaption, so keyboard users can scroll it (axe `scrollable-region-focusable`).
- The page itself never overflows (E2E at 390 px).

### D5. Content fixes while porting
- "Source: … (MIT, currently private)" becomes "(MIT, public)", since the repository is public.
- The header tag reads "Reference · __CS_NETWORK__ · updated 4 Oct 2026".
- Everything else matches the artifact and `docs/system-design.md`.

## Risks / Trade-offs

- **[Two copies of the design (the page and `docs/system-design.md`)]** → the page states it mirrors the doc and links
  it, and the live values can't drift (D3).
- **[Unknown chain]** → the build fails loudly rather than render a wrong network name.

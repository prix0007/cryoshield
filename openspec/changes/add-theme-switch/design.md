# Design

## Context

- Tokens live in `apps/web/src/ui/tokens.css`. Today the only dark switch is `@media (prefers-color-scheme: dark)`
  overriding the `--app-*` tokens, used by `/app/` and `/architecture`. The landing page (`landing.css`: "not themed")
  and the legal-layout pages (`legal.css`, `support.css`: "stays light in both themes") are light only.
- Every page carries the strict CSP (`script-src 'self'`, `require-trusted-types-for 'script'`, `trusted-types 'none'`,
  no inline script or style). `verify-build` checks the CSP on every page, the landing JS budget, analytics
  confinement, and that no shipped bundle references a storage API missing from `legal/storage-inventory.json`.
- The legal-layout pages (`/privacy`, `/terms`, `/cookies`, `/devices`) ship no JavaScript; `/support` ships a small
  copy-button module; `/architecture` ships none.
- `/privacy` and `/cookies` promise that no page stores anything on the device; lint bans `localStorage`,
  `sessionStorage` and `indexedDB` in `src/**/*.{ts,tsx}`.

## Goals / Non-goals

Goals: a System / Light / Dark switch on every page, the saved choice applied before first paint under the unchanged
CSP, one fail-safe storage key, honest privacy copy, and WCAG 2.2 AA contrast in both themes with automated coverage.

Non-goals: other preferences, cross-device sync, theming the landing's dark story tiles, changing the favicon or the
`theme-color` metas, any change to vault behaviour or vault storage (still memory only).

## Decisions

### D1. One classic script, emitted as a hashed asset

`src/theme/theme-init.js` is a plain, dependency-free classic script (an IIFE). It is the single implementation of the
theme logic for every page, including the React app:

1. **Pre-paint:** read `localStorage["cryoshield-theme"]` inside `try/catch`; only `light` or `dark` count, anything
   else (missing, invalid, throwing) is System. Set or remove `document.documentElement.dataset.theme`.
2. **Switch wiring by delegation:** one `change` listener on `document` handles every `select[data-theme-select]`
   (the static pages' switch and the one React renders later), applies the choice, saves it (`try/catch`; System
   removes the key), and syncs every switch on the page.
3. **On DOMContentLoaded:** set each switch's value from `<html data-theme>` and unhide `[data-theme-switch][hidden]`
   wrappers (the static pages render the switch `hidden`, so it never shows without the script).
4. **Other tabs:** a `storage` event for the key re-applies it, so open tabs stay consistent.

The applied choice is read back from `<html data-theme>`, not from storage, so a theme chosen while storage throws
still applies to the open page.

Why not a module script: module scripts are deferred and may run after first paint (a flash of the wrong theme). Why
not `public/`: files there are unhashed and would miss the immutable cache rule for `/assets/*`. So
`vite-plugins/theme.ts` emits the file as `assets/theme-<sha256/8>.js` (content hash, so builds stay reproducible)
and injects `<script src="…">` at the end of `<head>` on every page (`transformIndexHtml`, `injectTo: 'head'`), which
is after the CSP meta (placed right after `<meta charset>`), before `<body>`. In dev it points at
`/src/theme/theme-init.js`. The CSP is unchanged: `script-src 'self'` already allows it; it uses no HTML sink, so
Trusted Types are unaffected. The React `<select>` is uncontrolled (`defaultValue` from `<html data-theme>`), so React
never fights the script.

### D2. Token structure

```
:root                         light tokens; color-scheme: light dark
:root[data-theme='light']     color-scheme: light
:root[data-theme='dark']      color-scheme: dark; DARK TOKENS
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light'])   color-scheme: dark; DARK TOKENS
}
```

The two dark blocks are identical; `test/ui/tokens.test.ts` fails if they drift. `light-dark()` was considered, but an
unsupported browser would drop the whole custom property (invalid at computed-value time), leaving unreadable text.

New semantic page tokens (`--page-canvas`, `--page-parchment`, `--page-ink`, `--page-muted-80`, `--page-muted-48`,
`--page-hairline`, `--page-hairline-soft`, `--page-input-border`, `--page-link`, `--page-focus`, `--page-frost`,
`--page-pearl`) equal the existing base tokens in light and switch in dark. The landing and legal stylesheets map the
base tokens to them **only inside light surfaces** (`.tile-light`, `.tile-parchment`, the landing/architecture
sub-nav and footer, and the whole `.legal-page` body). The dark story tiles keep their own fixed tokens, and their
illustrations (which use e.g. `--canvas-parchment` for a paper sheet on a dark tile) are untouched.

`--color-primary-fill` (`#0066cc` in both themes) is the fill of primary pills and the skip link: in dark the link
colour becomes `#2997ff`, which fails with white text (2.9:1), so fills no longer share the link token.

### D3. Dark page palette

| Token | Light | Dark | Dark contrast |
|---|---|---|---|
| `--page-canvas` | `#ffffff` | `#000000` | |
| `--page-parchment` | `#f5f5f7` | `#1d1d1f` | |
| `--page-ink` | `#1d1d1f` | `#f5f5f7` | 19.3 on canvas, 16.0 on parchment |
| `--page-muted-80` | `#333333` | `#d2d2d7` | ≥ 11 |
| `--page-muted-48` | `#6e6e73` | `#a1a1a6` | 7.9 / 6.6 |
| `--page-hairline` | `#e0e0e0` | `#424245` | decorative |
| `--page-input-border` | `#86868b` | `#86868b` | 5.8 / 4.8 (≥ 3) |
| `--page-link` | `#0066cc` | `#2997ff` | 7.0 / 5.8 |
| `--page-focus` | `#0071e3` | `#2997ff` | ≥ 3 |

These match the app's existing dark tokens, so the whole site has one dark palette. The unit test checks every pair.

### D4. Switch placement and markup

In the black global nav, right-aligned after the links and before the narrow-width menu, at every width:
`<div class="theme-switch" data-theme-switch><label for="theme-select" class="sr-only">Theme</label><select
id="theme-select" data-theme-select>…</select></div>`. A native select gives the combobox role, keyboard support and
the platform picker for free. It sits on the black nav in both themes, so its own colours are fixed (white text,
`#86868b` border, 5.8:1 on black; focus ring `--color-primary-on-dark`), with `color-scheme: dark` for the native
popup. Height 44px; 16px text on coarse pointers (no iOS zoom on focus). The wordmark takes `margin-right: auto` so
links, switch and menu pack to the right; at 320px the wordmark, switch and menu fit with the 16px gutter.

### D5. Storage disclosure and guards

- `legal/storage-inventory.json`: `apis: ["localStorage"]`, `apiFiles: { "localStorage": "theme" }` (the asset name
  prefix allowed to contain it), routes unchanged (a page stores nothing on its own), and a new `preferences` list with
  the theme key. `/cookies` renders a second table, "Saved only if you choose it", from that list.
- `scripts/legal-check.mjs`: `storageApiOutsideAllowedFiles(files, inventory)` fails the build when a listed API
  appears in any file other than its allowed asset (so a future `localStorage` use elsewhere can't hide behind the
  theme exception). `unlistedStorageApis` is unchanged.
- ESLint keeps the storage ban on `src/**/*.{ts,tsx}` unchanged (`eslint.config.js` is not edited: the repo's
  config-protection hook refuses config edits). The theme script is `.js`, outside that ban by file type; its API
  surface is pinned by `test/theme/theme-init.test.ts` instead (no `sessionStorage`, `indexedDB`, `document.cookie`,
  `fetch`/`XMLHttpRequest`/`sendBeacon`, HTML sinks, `eval` or inline styles), and verify-build pins `localStorage` to
  its asset.
- Copy (`/cookies`, `/privacy`, both meta descriptions) changes from "stores nothing" to: no cookies; nothing is stored
  unless you pick Light or Dark, and then only that one choice, which never leaves your browser. Effective dates and
  changelog entries are updated (`check-legal-dates.mjs`).

## Risks / Trade-offs

- **Flash of the wrong theme** if the script fails to load: the page falls back to System (CSS media query), never to
  a broken state. Acceptable.
- **Switch without JS on the app**: impossible; the app needs JS. Static pages hide it without JS.
- **Landing rhythm in dark:** light tiles become black or near-black, so the light/dark alternation is softer. The
  dark story tiles use slightly lighter greys (`#252527`–`#2a2a2c`) than the dark canvas, so sections stay distinct.
- **Two dark blocks** could drift: guarded by the unit test.

## Security review (storage of a non-secret preference)

Scope: the new script, the stored key, the CSP and the build guards. No crypto, contract, paymaster or vault data is
touched.

| Area | Finding | Result |
|---|---|---|
| What is stored | One key, `cryoshield-theme`, value `light` or `dark`; written only on an explicit choice; System deletes it. No identifier, timestamp or vault data. | Pass |
| Fingerprinting / tracking | The value is never read into any request; no analytics reads it (the beacon is landing-only and confined by verify-build). A two-value preference adds about one bit that only same-origin script can read. | Pass |
| Untrusted input | The stored value is compared against the two literals; anything else is ignored, so a tampered value can't inject a selector, class or markup. `dataset.theme` is set only to `light` or `dark`. | Pass |
| CSP / Trusted Types | Same-origin external script, no inline code, no `innerHTML`/`eval`/`document.write`; CSP text unchanged on every page (verify-build). | Pass |
| Storage failures | Every `localStorage` access is in `try/catch`; Safari private mode, blocked storage or a full quota fall back to System (unit tests). | Pass |
| Secret handling | Vault data, PRF output and keys remain memory-only; the lint storage ban still covers all TS/TSX; verify-build allows `localStorage` only in the theme asset. | Pass |
| Supply chain | No new dependency. | Pass |

Recorded by the frontend engineer; the ECC code and accessibility reviews are listed in tasks.md section 5.

> **Archive after:** add-privacy-and-compliance (this change MODIFIES requirements of `legal-pages` and
> `privacy-compliance`, which that change adds and which are not yet in `openspec/specs/`).

# Proposal

## Why

Founder request, 2026-10-08: "Also add theme as well, use ecc to keep contrast in both themes great."

Today the colour scheme follows only the operating system's setting (`prefers-color-scheme`), and only the vault app
(`/app/`) and `/architecture` have a dark appearance; the landing page and the legal-layout pages (`/privacy`, `/terms`,
`/cookies`, `/devices`, `/support`) are always light. People who want a dark site on a light system (or the reverse)
have no way to choose, and the site looks inconsistent when they move between pages.

Founder decision (asked explicitly): a switch with three choices, **System** (the default, follows the device), **Light**
and **Dark**, and the choice **is remembered** in the browser. Because `/privacy` and `/cookies` promise that CryoShield
stores nothing on your device, that copy must change, honestly, to disclose exactly this one stored preference.

## What Changes

- **Theme switch** in the black global nav of every page (landing, `/app/`, `/architecture`, `/devices`, `/support`,
  `/privacy`, `/terms`, `/cookies`): a native, labelled `<select>` ("Theme": System, Light, Dark), keyboard and
  screen-reader operable, 44px tall, phone-width friendly. On the static pages it appears only when JavaScript runs.
- **Before first paint:** a tiny same-origin classic script (`src/theme/theme-init.js`, emitted as a hashed
  `/assets/theme-<hash>.js` by a small Vite plugin and loaded in `<head>` after the CSP meta) reads the saved choice
  and sets `<html data-theme="light|dark">` before the body is parsed. Every storage access is wrapped in `try/catch`;
  a missing, invalid or throwing storage means System. No inline script, no inline style, CSP unchanged.
- **One remembered preference:** `localStorage["cryoshield-theme"]` = `"light"` or `"dark"`. Choosing System deletes
  the key. It holds no identifier, is never sent anywhere, and is cleared with the browser's site data. Nothing is
  stored until a visitor picks Light or Dark.
- **Tokens restructured:** `:root[data-theme="dark"]` forces dark, `:root[data-theme="light"]` forces light, and the
  `prefers-color-scheme: dark` query applies only when no explicit theme is set (`:root:not([data-theme="light"])`).
  `color-scheme` follows the theme so native controls match.
- **Every page gets a dark appearance:** the landing page's light tiles, sub-nav and footer, and the legal-layout pages,
  are themed through new `--page-*` tokens (the landing's dark tiles are dark in both themes, as today). Filled pills
  keep Action Blue (`--color-primary-fill`) with white text in both themes.
- **Contrast (WCAG 2.2 AA) in both themes:** the token unit test covers the new page tokens in light and dark, and a
  new E2E spec runs axe (colour-contrast included) on the landing page, a legal page, the app home, an open vault, the
  vault list and the editor, in forced Light and forced Dark.
- **Honest privacy copy:** `/cookies` and `/privacy` (and their meta descriptions) disclose the one theme key; the
  device-storage inventory (`legal/storage-inventory.json`) lists it as a preference saved only on choice; the build
  guard allows `localStorage` **only** in the theme script and still refuses every other storage API anywhere.
- **Lint:** the browser-storage ban stays for all app TypeScript, unchanged; the theme script (plain JS) is the single,
  documented exception, its API surface pinned by a unit test and its storage by verify-build.

**Out of scope:**
- any other preference, setting or storage (the app's vault data stays in memory only, unchanged);
- syncing the theme across devices or sending it anywhere;
- the landing page's dark story tiles, which stay dark in both themes (they are the page's cinematic rhythm);
- the favicon (it already follows the device scheme) and the `theme-color` meta tags (they keep following the device;
  the global nav they colour is black in both themes);

**Runtime dependencies:** none. No new package, no network request, no CryoShield-operated backend. The theme script
is a static same-origin file.

## Capabilities

### New Capabilities
- `site-theme`: the theme choice (System, Light, Dark), how it is applied before first paint under the strict CSP,
  how it is remembered (one key, fail-safe), which pages it themes, and the contrast it guarantees in both themes.

### Modified Capabilities
- `app-visual-design`: "Token contrast" now covers forced Light and forced Dark as well as the system scheme, and the
  page tokens; "Navigation chrome" includes the theme switch.
- `legal-pages` (pending in add-privacy-and-compliance): "Cookie policy page" and "Device-storage inventory" disclose
  the theme preference and test it.
- `privacy-compliance` (pending in add-privacy-and-compliance): "No CryoShield-side identifiers" allows exactly the
  theme preference, which is not an identifier.

## Impact

- `apps/web/src/theme/theme-init.js` (new), `apps/web/vite-plugins/theme.ts` (new), `vite.config.ts`.
- `apps/web/src/ui/tokens.css`, `chrome.css`, `global.css`, `chrome.tsx`; `src/landing/landing.css`;
  `src/legal/legal.css`; `src/support/support.css`; `src/architecture/architecture.css`.
- Headers: `index.html`, `legal/partials/header.html` (all legal-layout pages and `/architecture`).
- Legal copy: `legal/cookies.md`, `legal/privacy.md`, `cookies/index.html`, `privacy/index.html` descriptions,
  `legal/storage-inventory.json`, `vite-plugins/legal.ts` (preferences table).
- Guards: `scripts/legal-check.mjs`, `scripts/verify-build.mjs`.
- Compliance records that said "no storage": `docs/compliance/data-inventory.md`, `erasure-procedure.md`,
  `legal-analysis.md` (overwatcher approved updating them on this branch).
- Tests: `test/theme/*`, `test/ui/tokens.test.ts`, `test/build/*`, `e2e/specs/19-theme.spec.ts`, `08-legal.spec.ts`.

# Tasks

## 1. Content (tests first)

- [x] 1.1 Content tests (`test/legal/lost-key.test.ts`):
  - a valid "Last reviewed" date, not in the future;
  - the sections and the six steps in order;
  - the old-versions and any-key statements; the clear-sheet warnings quoted verbatim from `strings-vaults.ts`;
  - no key-removal, deletion or PIN-count claim; the never-share warning; no recovery offered by CryoShield;
  - safe rendering.
- [x] 1.2 Write `docs/lost-or-compromised-key.md`.

## 2. Page and links

- [x] 2.1 Build tests: `/lost-key` emitted with the h1 and title, the app CSP, only the theme script, no third-party
  resource and no analytics; the footer link on every page; the FAQ link.
- [x] 2.2 Implement: the `lost-key/index.html` shell and `renderRepoDoc`; the Vite input and clean-URL rewrite;
  gen-context (Caddy route, no-cache, CSP pages); verify-build page lists; the SEO page list; the smoke test.
- [x] 2.3 Links: footers (landing, legal partial, app); the FAQ sentence; the vault-view link (unit test).

## 3. Verification

- [x] 3.1 Container route test (`/lost-key` 200 with headers and no analytics; `/lost-key/` 200; `/lost-key/x` 404).
- [x] 3.2 E2E `22-lost-key.spec.ts` (desktop and mobile shards): render and axe in light and dark, only same-origin
  requests, footer link, FAQ link, and the vault-view link opening the page.
- [x] 3.3 `openspec validate --all --strict`; web lint, typecheck, unit, build, e2e.

  2026-10-12: 40 changes valid; typecheck and lint clean; 1445 unit tests; deploy suites (gen-context, container,
  noindex); verify-build for both builds; 402 CI script tests; e2e 22-lost-key, 14-devices, 18-vault-layout,
  21-mobile, 30-a11y, 16-seo and 08-legal on the desktop and phone projects (60 tests) pass.

## 4. Security review and records

- [x] 4.1 Security review recorded in `design.md` (claims, rendering, route, link).
- [x] 4.2 Record the founder's acceptance of the mobile signer gap in `harden-gas-sponsorship` 6.3.

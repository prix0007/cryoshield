# Tasks

## 1. Content (tests first)

- [ ] 1.1 Content tests (`test/legal/lost-key.test.ts`):
  - a valid "Last reviewed" date, not in the future;
  - the sections and the six steps in order;
  - the old-versions and any-key statements; the clear-sheet warnings quoted verbatim from `strings-vaults.ts`;
  - no key-removal, deletion or PIN-count claim; the never-share warning; no recovery offered by CryoShield;
  - safe rendering.
- [ ] 1.2 Write `docs/lost-or-compromised-key.md`.

## 2. Page and links

- [ ] 2.1 Build tests: `/lost-key` emitted with the h1 and title, the app CSP, only the theme script, no third-party
  resource and no analytics; the footer link on every page; the FAQ link.
- [ ] 2.2 Implement: the `lost-key/index.html` shell and `renderRepoDoc`; the Vite input and clean-URL rewrite;
  gen-context (Caddy route, no-cache, CSP pages); verify-build page lists; the SEO page list; the smoke test.
- [ ] 2.3 Links: footers (landing, legal partial, app); the FAQ sentence; the vault-view link (unit test).

## 3. Verification

- [ ] 3.1 Container route test (`/lost-key` 200 with headers and no analytics; `/lost-key/` 200; `/lost-key/x` 404).
- [ ] 3.2 E2E `22-lost-key.spec.ts` (desktop and mobile shards): render and axe in light and dark, only same-origin
  requests, footer link, FAQ link, and the vault-view link opening the page.
- [ ] 3.3 `openspec validate --all --strict`; web lint, typecheck, unit, build, e2e.

## 4. Security review and records

- [ ] 4.1 Security review recorded in `design.md` (claims, rendering, route, link).
- [ ] 4.2 Record the founder's acceptance of the mobile signer gap in `harden-gas-sponsorship` 6.3.

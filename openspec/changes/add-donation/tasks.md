# Tasks

## 1. Source and checks (tests first)

- [x] 1.1 `config/donation.json`. Tests: the exact value, a valid EIP-55 checksum, chain 1, `loadDonation` refusing a tampered value, and the README "Support the project" section carrying the same and only address.
- [x] 1.2 `vite-plugins/donation.ts`: validation, the EIP-681 URI and the build-time QR SVG (pinned MIT `qrcode-generator`). Test: decode the SVG with pinned `jsqr` back to the exact URI.
- [x] 1.3 Anti-swap `scripts/donation-check.mjs` (unit tests) wired into verify-build, plus the `window.ethereum` ban.

## 2. Page, button, legal

- [x] 2.1 `/support` (static, app CSP, no analytics) with the address, QR, Open in wallet, Copy (`src/support/copy.ts`, unit tests: copies exactly, never clears, fallback), warnings and terms.
- [x] 2.2 The coffee pill (CSS steam, Motion `motion/mini` sheen on the landing, lazily loaded; unit tests) and the compact footer link on every page.
- [x] 2.3 Wiring: the Vite input, clean URL, gen-context route and CSP pages, verify-build page lists, the smoke test and fixture, and the CI path filter.
- [x] 2.4 `/terms` and `/privacy` donation sections, with effective dates updated.

## 3. Verification

- [x] 3.1 Built-page tests: `/support` content, the QR decoded from the built HTML, the CSP, no wallet code; the footer link on every page; legal sections.
- [x] 3.2 Container route test for `/support`; E2E `15-support.spec.ts`: the footer link on every page with axe in light, dark and reduced motion; the pill hover with motion and static under reduced motion; `/support` rendering and Copy.
- [x] 3.3 Screenshots in `apps/web/docs/screenshots/`.

## 4. Review

- [x] 4.1 Security review of the address-swap threat model (design, "Threat model: address swap"): the single source, the anti-swap check, no wallet code, CSP unchanged. Record it in `docs/reviews/add-donation.md`.

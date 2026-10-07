# Tasks

> **Archive after:** add-web-app (see the proposal).

## 1. Tests first

- [x] 1.1 `test/config/networks.test.ts`:
  - the names and explorers of OP Sepolia, OP Mainnet and anvil (no explorer);
  - an unknown chain gets a fallback name and no explorer;
  - the address, tx and Arweave link builders reject malformed values.

  Verify it fails before 2.1.
- [x] 1.2 `test/mirror/mirror.test.ts`: `ensure()` returns the ID of the item it byte-verified, or of the one it
  uploaded. Verify it fails before 2.2.
- [x] 1.3 `test/ui/vault-location.test.tsx` (RTL):
  - collapsed by default, and opening shows network, chain ID, registry and version, vault ID, owner and version;
  - explorer links have `target="_blank"` and `rel="noopener noreferrer"`;
  - Copy writes the full value and announces it;
  - no locator text appears;
  - the last save shows only after a save in this session, and the Arweave copy only when known;
  - a v1 vault says read-only;
  - no links without an explorer;
  - Lock removes every value;
  - axe finds no violations with the section open.

  Verify it fails before 2.3.
- [x] 1.4 Jargon scan (`guards.test.tsx`) covers the new strings, unchanged.

## 2. Implementation

- [x] 2.1 `src/config/networks.ts` and the runtime `network` (Vite plugin, `vite-env.d.ts`, the test virtual config).
  The architecture page reuses the names. Verify 1.1 and `test/build/architecture.test.ts` pass.
- [x] 2.2 `mirror.ensure()` returns `{ state, id }`, and `ensureMirror` passes the item ID through. Verify 1.2 passes.
- [x] 2.3 `VaultSession.lastSave` from create/edit/add-key, and the mirror item in `VaultView`. Add the
  `Services.network`, `registries` and `arweaveGatewayUrl` fields and `copyPublic`. Add the lazy `VaultLocation`
  panel in a `Disclosure` on the view, its strings and styles. Verify 1.3 and 1.4 pass, as does the full unit suite.
- [x] 2.4 E2E: in `10-flows.spec.ts`, after the edit save:
  - open the section (the lazy chunk loads under the strict CSP);
  - check the vault ID, the last save, and the Arweave link's `href`, `target` and `rel`;
  - check that no locator appears and that no request leaves the app origin;
  - check that Lock removes the section.

  Anvil has no explorer, so explorer links are covered by the unit tests. Verify the full E2E run is green.
- [x] 2.5 `verify-build --mode e2e` passes, with the CSP unchanged and `/app` initial JS within budget. Record the
  bundle delta.

  **Result:** `/app` initial JS gzip went from 215,698 B to 216,199 B (+501 B). It is within the budget of
  196,737 B + 20,480 B. The lazy chunks went from 15,938 B to 17,164 B (+1,226 B, the panel and its strings). After the
  review fixes (section 4): initial is 216,554 B (+856 B over main, 663 B of budget left), and lazy is 17,132 B.
- [x] 2.6 Docs: one line in `docs/system-design.md`, and a manual step in `apps/web/docs/hardware-test.md`.

## 3. Review

- [x] 3.1 Security review: only public data, no locators or key material, link-target validation, `noopener
  noreferrer`, no new `connect-src`, and content wiped on lock. Record the result in this file's checkbox and in the
  PR description.

  **Result (2026-10-07): no findings.**
  - The panel receives only the vault ID, owner, version, registry, chain, the last save's hash and the Arweave ID.
    `VaultView` never passes it the locator or the credential IDs. Unit and E2E tests assert that no locator appears.
  - Link targets combine build-time bases with values matching `0x`+40 hex, `0x`+64 hex, or 43-character base64url.
    Anything else is shown without a link. React escapes all text, including the untrusted gateway-listed ID.
  - Links use `target="_blank" rel="noopener noreferrer"`, under the existing `Referrer-Policy: no-referrer`.
  - The CSP is unchanged: verify-build's `connect-src` token match passes. The lazy chunk is same-origin
    (`script-src 'self'`, Trusted Types unaffected). E2E records no request beyond the app origin while the panel opens.
  - `copyPublic` leaves the secret auto-clear timer and its callback untouched.
  - On lock, `App.lock()` drops the session and unmounts `VaultView`, together with its mirror state and the panel.
    Unit and E2E tests confirm nothing remains in the DOM.
  - A side effect: the architecture page now also has names for Arbitrum Sepolia and Arbitrum One (shared table), so a
    build for those chains no longer fails on a missing network name.

## 4. Review fixes (ECC review of 1df30da)

- [x] 4.1 HIGH: an error boundary around the lazy panel. Test: `test/ui/vault-location-chunk.test.tsx`, where the
  import rejects, shows the hint, and the vault still shows and reveals secrets.
- [x] 4.2 MEDIUM: the Arweave item is kept in `App` per `registry:vaultId`, newest version wins, cleared on lock, and a
  post-lock result is ignored. It survives "Open an older test vault" and back.
  - Tests: an out-of-order result, the older-vault round trip, and the create flow recording an upload that finishes
    after Continue (the optional LOW).
- [x] 4.3 MEDIUM: tests for the version gates: an add-key save with no hash hides the older last save, and an older
  version's Arweave copy is hidden. A mutation check, removing the gates, makes both fail.
- [x] 4.4 LOWs:
  - the link name is one sr-only text run containing the visible text (no `aria-label`);
  - repeated copies are re-announced;
  - Arweave IDs are validated before entering state;
  - `copyPublic` cancels a pending secret clear (`test/ui/clipboard-public.test.ts`);
  - the redundant `'itemId' in` is gone (the code moved);
  - the test imports are reordered.

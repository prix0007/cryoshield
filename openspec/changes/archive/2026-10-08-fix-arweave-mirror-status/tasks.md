# Tasks

## 1. Regression tests first

- [x] 1.1 `test/mirror/mirror.test.ts`:
  - `ensure()` is present (no upload) when arweave.net has nothing but the fast index has identical bytes;
  - it uploads when the fast-index bytes differ;
  - a failure on one index is tolerated;
  - data is fetched from the host that listed it.

  Verify they fail before the fix.
- [x] 1.2 `test/ui/mirror-status.test.tsx`:
  - `mirrorWrite` with `locatorsOf` rejecting still uploads with the given locators;
  - create-flow Retry passes the creation locators;
  - a 402 upload shows Details `UPLOAD_FAILED · HTTP 402 · upload`;
  - success shows the item link and the settlement note.

  Verify they fail before the fix.
- [x] 1.3 Config and CSP tests:
  - schema: the default and validation of `VITE_ARWEAVE_FAST_INDEX_URL`;
  - `gen-context`: the landing may drop a `connect-src` source but not add one;
  - container: `/app/` CSP has `https://turbo-gateway.com`, `/` does not.

## 2. Fix

- [x] 2.1 Implement D1 (two-index lookup and ensure), D2 (Retry locators), D3 (results, Details, item link) and D4 (config, CSP, inventory, `.env.example`, `.env.e2e`). Update the E2E Arweave stub with a settlement lag (arweave.net empty until settled, fast index immediate) and the network allowlist. Verify that 1.1–1.3 pass and the full E2E is green.
- [x] 2.2 Disclose the fast index in `/privacy` (new effective date + changelog), `docs/compliance/data-inventory.md` and `origins.json`. Verify with the legal page tests and verify-build's origin check.

## 3. Review

- [x] 3.1 Security review of the new `connect-src` host (scope, data sent, spoofing, landing exclusion). Record it in `apps/web/docs/security-review-mirror-status.md`.

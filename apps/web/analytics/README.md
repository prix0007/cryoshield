# Landing analytics: the pinned Cloudflare beacon

The landing page (`/` only) loads Cloudflare Web Analytics from
`https://static.cloudflareinsights.com/beacon.min.js` with a SHA-384 `integrity` attribute taken from
[`beacon.lock.json`](beacon.lock.json) (OpenSpec `add-privacy-preserving-analytics`, design D4b). Browsers refuse any
other bytes, so a Cloudflare update switches analytics **off** (fail closed) until someone reviews it. Nothing else on
the site is affected.

- **Token:** set `VITE_CF_BEACON_TOKEN` (the 32-hex site token from the Cloudflare Web Analytics dashboard, "manual JS
  snippet", no proxy) in `apps/web/.env`. Unset means no beacon and no Cloudflare origin in any CSP.
- **Drift check:** `.github/workflows/beacon-drift.yml` runs weekly (and on demand). Locally:
  `node apps/web/scripts/beacon-drift.mjs`.

## Review-and-bump procedure (security-reviewer)

1. Download the new file: `curl -sS -o new.js https://static.cloudflareinsights.com/beacon.min.js`. Get the previous
   one from Cloudflare's CDN history if available, or from your last review notes.
2. Pretty-print both (`npx prettier --parser babel`) and diff them. Look for:
   - new DOM sinks (`innerHTML`, `insertAdjacentHTML`, `document.write`, `createElement`/`setAttribute` on scripts);
   - `eval`/`new Function`/`WebAssembly`;
   - storage (`document.cookie`, `localStorage`, `sessionStorage`, `indexedDB`);
   - new network destinations other than `https://cloudflareinsights.com/cdn-cgi/rum`;
   - new data read from the page (form fields, URLs with query strings, `history` hooks while `spa` is false).
3. If acceptable, update `sha384` (`openssl dgst -sha384 -binary new.js | openssl base64 -A`, prefixed `sha384-`),
   `bytes`, `version` (ETag / Last-Modified), `reviewedBy`, `reviewedAt` and `reviewNotes` in `beacon.lock.json`.
4. Run `pnpm --filter @cryoshield/web verify-build` and the analytics E2E (`pnpm exec playwright test --project analytics`).
5. If anything new reads or stores data, update `/privacy` and `/cookies` (`apps/web/legal/`) first, with a new
   effective date.

If the file is not acceptable, leave the lock as is: analytics stays off, and the site is unaffected.

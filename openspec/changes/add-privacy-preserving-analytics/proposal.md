# Proposal

## Why

The PRD's success metric is "10,000 vaults created", and the founder decided on 2026-10-02 to measure the product
**"on-chain + cookieless"**: product metrics from public on-chain events plus the Pimlico sponsorship dashboard, with
zero user tracking, and a cookieless, no-PII analytics service on the **landing page only**. App pages that handle
keys or secrets stay analytics-free. Today there is no tooling for either, and no guarantee that analytics could never
leak into `/app`.

## What Changes

- **Product metrics (no tracking):** a read-only TypeScript CLI, `tools/metrics`, that reads `VaultCreated`,
  `VaultUpdated` and `LocatorAdded` logs, EntryPoint `UserOperationEvent` logs and Arweave GraphQL. It reports vault
  counts, keys per vault, updates, weekly active vaults, Arweave mirror coverage and sponsored gas spend, as aggregate
  JSON with no identifiers. A weekly GitHub Actions workflow runs the same CLI and uploads the JSON as an artifact.
  Pimlico's USD bill is read monthly from the Pimlico dashboard and reconciled with the on-chain gas total.
- **Landing analytics (founder decision 2026-10-03): Cloudflare Web Analytics, "beacon only".** Fly keeps hosting
  and TLS, with no Cloudflare proxy and no DNS change. The beacon is inserted on `/` only, after a GPC/DNT/host gate,
  with query and fragment stripped first and `spa: false`. It loads with a committed SHA-384 `integrity` hash:
  self-hosted under `'self'` if Cloudflare permits, otherwise from `static.cloudflareinsights.com`, failing closed when
  Cloudflare updates the file. Cloudflare does not support version-pinning the beacon (design D4). A weekly drift job
  flags updates for review.
- **Per-route CSP and headers:** only the landing document adds `https://cloudflareinsights.com` to `connect-src`
  (plus the beacon host to `script-src` in the CF-hosted fallback). It also disables WebAuthn through
  Permissions-Policy. Every other path keeps the app CSP. This **modifies** spec `landing-page` "Same security headers
  and CSP on every page".
- **Same-origin hardening:** the app refuses to start when it has a same-origin `window.opener`, so landing-page
  script can't drive it.
- **Hard guarantees** (spec `landing-analytics`): no analytics code or requests on `/app/` or the legal pages; no URL
  parameters, fragments, cookies or identifiers; GPC and DNT suppress the beacon entirely; disclosure on `/privacy`
  and `/cookies`, checked at build time.
- **Dependency:** `redesign-landing-and-app-ui` is merged (landing at `/`, app at `/app/`), so nothing blocks this.
  The disclosure depends on the legal pages from `add-privacy-and-compliance`. Both ship **before public launch**.

**Out of scope:**
- any analytics, telemetry, error reporting or session replay on `/app`, `/privacy`, `/terms`, or the desktop tool;
- cookies, fingerprinting, cross-site tracking, ad pixels, A/B testing, or conversion attribution;
- a dashboard server, database, or any CryoShield-operated backend or proxy service;
- publishing per-address or per-vault data, even though it is public on-chain;
- unlock success-rate telemetry (stays the manual compatibility matrix, as the PRD says).

**Runtime dependencies:** Cloudflare Web Analytics (`cloudflareinsights.com`, plus `static.cloudflareinsights.com` in
the fallback), from the landing page only. It is a vendor service, not a CryoShield-operated backend, and it never sits
in the path of the app or its crypto code. The metrics CLI adds no runtime dependency to the
site; it runs locally or in GitHub Actions against public RPCs and the Arweave gateway already in use.

## Capabilities

### New Capabilities
- `product-metrics`: aggregate, identifier-free product metrics computed from public chain and Arweave data, and how they are produced.
- `landing-analytics`: the cookieless landing-page analytics and the guarantees that keep it off app routes.

### Modified Capabilities
- `landing-page`: "Same security headers and CSP on every page" now allows a distinct landing CSP (the analytics sources only) and a landing Permissions-Policy without WebAuthn.

## Impact

- New: `tools/metrics/` (TS CLI + tests), `.github/workflows/metrics.yml`, `.github/workflows/beacon-drift.yml`,
  `apps/web/analytics/beacon.lock.json`, `src/landing/analytics.ts`.
- Changed: `vite-plugins/csp.ts` (two CSPs), `deploy/gen-context.mjs` (per-route header blocks; relaxed
  identical-CSP guard), `scripts/verify-build.mjs`, the app boot (opener check), E2E and container tests, `/privacy`
  and `/cookies` text, `.env.example` (`VITE_CF_BEACON_TOKEN`).
- Founder ops: Cloudflare account and Web Analytics site (manual snippet), DPA acceptance, the redistribution question
  to Cloudflare, and Pimlico dashboard exports.

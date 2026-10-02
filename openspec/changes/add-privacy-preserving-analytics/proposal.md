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
- **Landing analytics:** a cookieless, first-party-bundled page-view client on `/` only, sending to one vendor event
  endpoint (recommended vendor: see design.md D4). The script is bundled, so `script-src 'self'` stays; only the landing
  route's `connect-src` gains the vendor origin, using a per-route CSP from Caddy.
- **Hard guarantees** (spec `landing-analytics`): no analytics code or requests on `/app`; no URL parameters,
  fragments or identifiers sent; GPC and DNT honoured; per-route CSP; disclosure on `/privacy` checked at build time.
- **Dependency:** this change is a **follow-up to `redesign-landing-and-app-ui`** (branch `feat/ui-redesign`), which
  introduces the separate landing page at `/` and the app at `/app`. Landing analytics cannot be implemented until
  that change is merged. The metrics CLI (task groups 1 and 2) does not depend on it and can start now. The `/privacy`
  disclosure depends on `add-privacy-and-compliance`.

**Out of scope:**
- any analytics, telemetry, error reporting or session replay on `/app`, `/privacy`, `/terms`, or the desktop tool;
- cookies, fingerprinting, cross-site tracking, ad pixels, A/B testing, or conversion attribution;
- a dashboard server, database, or any CryoShield-operated backend or proxy service;
- publishing per-address or per-vault data, even though it is public on-chain;
- unlock success-rate telemetry (stays the manual compatibility matrix, as the PRD says).

**Runtime dependencies:** one new third-party endpoint, the analytics vendor's event API, called from the landing page
only. It is a vendor service, not a CryoShield-operated backend. The metrics CLI adds no runtime dependency to the
site; it runs locally or in GitHub Actions against public RPCs and the Arweave gateway already in use.

## Capabilities

### New Capabilities
- `product-metrics`: aggregate, identifier-free product metrics computed from public chain and Arweave data, and how they are produced.
- `landing-analytics`: the cookieless landing-page analytics and the guarantees that keep it off app routes.

### Modified Capabilities
None in `openspec/specs/`. The per-route CSP changes the `web-hosting` capability, which is still in flight in
`add-fly-hosting`. The requirement lives here as `landing-analytics` "Per-route Content Security Policy" and must be
reconciled with `web-hosting` when both are archived (task 6.4).

## Impact

- New: `tools/metrics/` (TS CLI and tests), `.github/workflows/metrics.yml`.
- Changed after `redesign-landing-and-app-ui` lands: the landing entry (`src/landing/analytics.ts`),
  `vite-plugins/csp.ts` (two CSPs), `deploy/gen-context.mjs` (per-route header blocks), `scripts/verify-build`, E2E
  tests, and `/privacy` text.
- Founder ops: vendor account and DPA, Pimlico dashboard export.

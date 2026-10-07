# Design

## Context

See proposal.md for the motivation. Constraints observed in the repo (rebased on `main`, 2026-10-03):
- `redesign-landing-and-app-ui` is merged and archived. Vite builds two entries, `index.html` (landing, `/`) and
  `app/index.html` (`/app/`); `/app` redirects to `/app/`. `vite-plugins/csp.ts` injects one CSP meta tag
  (`default-src 'none'`, `script-src 'self'`, `connect-src 'self' <origins>`, Trusted Types `'none'`) into both.
  `deploy/gen-context.mjs` refuses to run unless both meta tags are identical, and emits one Caddy `header` block for
  every path. Spec `landing-page` "Same security headers and CSP on every page" requires this, so this change
  **modifies** that requirement.
- **Both the meta CSP and the HTTP CSP are enforced**, so a per-route change needs per-document meta tags *and*
  per-path headers.
- Caddy has no `log` directive, so it writes no access log.
- `/` and `/app/` share one origin (`https://cryoshield.app`, which is also the RP ID).
- `VaultRegistry` events:
  - `VaultCreated(vaultId indexed, owner indexed, version, blobHash)`;
  - `VaultUpdated(vaultId indexed, version, blobHash)`;
  - `LocatorAdded(vaultId indexed, locator indexed)`.
- The blob header carries the key count N in cleartext. EntryPoint v0.6 emits `UserOperationEvent(userOpHash, sender
  indexed, paymaster indexed, nonce, success, actualGasCost, actualGasUsed)`.
- The recovery tool already pages `eth_getLogs` adaptively.
- **Founder decision 2026-10-03:** Cloudflare Web Analytics, "Analytics beacon only". Fly keeps hosting and TLS; no
  Cloudflare proxy; DNS unchanged. The beacon runs on `/` only, pinned with SRI, with a per-route CSP.

## Goals / Non-Goals

**Goals:** answer "how many vaults, how active, how much gas, is the mirror healthy" from public data; count landing
visits with no cookies and no identifiers; make it impossible by test for analytics to reach `/app`.

**Non-Goals:** funnels from landing to vault creation (that would need joining a visitor to an on-chain account,
which is exactly the tracking we refuse); per-user metrics; real-time dashboards.

## Decisions

### D1. Metrics run as a local CLI plus a weekly GitHub Action (one codebase)
- `tools/metrics` is a TypeScript CLI (viem, already a dependency of `apps/web`). It runs locally (`pnpm metrics --network op-sepolia`) and in `.github/workflows/metrics.yml` (weekly cron + manual dispatch), which uploads `metrics.json` as a 90-day workflow artifact.
- *Why both:* the Action gives a regular history without anyone remembering to run it and needs no secrets, because every input is public. The CLI lets anyone, including outside auditors, reproduce a number. Neither is a server we operate, so the "no backend" rule holds.
- *Alternatives rejected:*
  - a static dashboard page that queries RPCs from visitors' browsers: it adds `eth_getLogs` load to public RPCs on every view and an extra page to secure, for little benefit;
  - committing the JSON back to the repo: it needs `contents: write`, which breaks the CI hardening rule (`permissions: contents: read`);
  - The Graph, Dune or Goldsky: a third-party indexer adds an account and a dependency, and Dune does not index OP Sepolia well (UNVERIFIED). Revisit on mainnet if `eth_getLogs` paging becomes slow; Dune on OP Mainnet would be a good public dashboard then.

### D2. What is measured, and how
| Metric | Source |
|---|---|
| Vaults total, created per ISO week | `VaultCreated` count, block timestamps |
| Updates per week | `VaultUpdated` count |
| Keys per vault | key count N byte from the latest blob (`getVault`), as a distribution |
| Weekly active vaults | distinct vaultIds with any of the 3 events in the week (an "address" proxy: one account owns one vault, `OwnerAlreadyHasVault`) |
| Mirror coverage | Arweave GraphQL by `CryoShield-Vault-Id` + `CryoShield-Version`, byte-checked against `blobHash` |
| Sponsored gas | `UserOperationEvent` filtered by `paymaster` topic ∈ sponsor paymasters, `sender` ∈ vault owners; sum `actualGasCost` |
| USD bill | Pimlico dashboard, monthly, by hand (Pimlico bills in USD and adds 10% on mainnet, free on testnets: docs.pimlico.io/guides/pricing). A usage-export API is UNVERIFIED; the platform API lists sponsorship policies (docs.pimlico.io/references/platform/api/sponsorship-policies/list) |

- Output is aggregate only, and buckets under 3 are suppressed on public networks. Every input is public, but the report must not become a convenient index of who uses CryoShield, and aggregates keep the report outside personal-data rules.
  - Security review of the metrics work (2026-10-08) showed that hiding cells as `"<3"` is not enough: hidden cells could be recovered by subtracting from totals, and by comparing successive weekly reports. So on public networks:
    - the run stops at the end of the last complete ISO week (`through_week`), so a week's data never changes once published;
    - time series (weekly creates, updates, active vaults, sponsored gas) are merged chronologically into week ranges (`2026-W40..2026-W42`) until each covers at least 3 vaults or accounts. A range depends only on data up to its own last week, so it is identical in every later report. The open trailing range is reported only as `"<3"` (`*_pending`) and is part of no total;
    - snapshot metrics (total vaults, vaults per registry, keys per vault, mirror coverage) cover only the vaults created in closed ranges, which grow in steps of at least 3. Categories are merged (`"2-3"` keys, `"v1+v2"`) instead of hidden. When 1 or 2 vaults are unmirrored, mirror coverage shows only bounds;
    - excluded gas (unsponsored or another paymaster) is reported as counts only, never as wei.
  - Accepted residual: keys per vault and mirror coverage use each vault's latest state, so successive reports can differ when an existing vault adds a key or gets mirrored. Both are public facts, and the report never links them to a vault.
  - Before writing, the tool scans its own report and refuses any 20/32-byte hex value other than the registry addresses (spec "Report scan"), so a future field cannot leak an identifier silently.
  - Registries: every version in the deployment record is read (v1 top-level, `contracts.vaultRegistryV<N>`, `contracts.vaultRegistries.v<N>`), with the read ABI chosen by `abiHash` as in `tools/recover`; vault counts are also split by registry version.
- The scheduled workflow is held to a `SCHEDULED_READ_ONLY` profile in `.github/scripts/workflow-policy.mjs` (also applied to `beacon-drift.yml`): schedule and input-less dispatch only, no `secrets` or `github.token` reference at all (it is not PR-triggered, so the generic rule would not apply), only `contents: read`, no persisted credentials, no environment, only allow-listed actions (checkout, pnpm setup, setup-node, upload-artifact) and allow-listed commands in `run` steps (`pnpm`, `node`, `echo`, `cat`), and an `upload-artifact` with `retention-days` ≤ 90.


### D3. Per-route CSP and headers: landing document vs everything else
- `csp.ts` emits two CSPs:
  - the **app CSP**, unchanged, for every HTML document except `index.html`;
  - the **landing CSP** for `index.html` = the app CSP plus `https://cloudflareinsights.com` in `connect-src`, and
    the beacon source in `script-src` only when the founder chooses the CF-hosted path (D4b). The self-hosted path
    (D4a) keeps `script-src 'self'`.
- `gen-context.mjs`:
  - reads each HTML file's meta CSP and checks that the landing CSP differs from the app CSP only by the allowed
    sources;
  - emits a Caddy header block for `@landing path / /index.html`, with the landing CSP and a Permissions-Policy that
    sets `publickey-credentials-get=()` and `publickey-credentials-create=()`;
  - emits the default block (app CSP, existing Permissions-Policy) for every other path, including 404 and error
    responses.
- *Rejected:* one CSP with the Cloudflare origins for all routes. A compromised or malicious beacon would then also
  have egress from `/app/`, where secrets live.
- *Risk:* path normalisation (`/index.html`, `//`, `/App/`, `/%61pp/`, `/app` redirect). Covered by the container
  tests (task 4.4) and the security review (6.1).

### D4. Vendor: Cloudflare Web Analytics, "beacon only" (founder decision 2026-10-03)
**Research findings** (accessed 2026-10-03; H = high, M = medium, L = low confidence):
- *Cookieless:* Cloudflare says it "does not use any client-side state, such as cookies or localStorage", and doesn't
  fingerprint by IP or UA "for the purpose of displaying analytics" (cloudflare.com/web-analytics, H for the claim).
  A 2020 review found a cookie set when the beacon downloaded, which Cloudflare said it would deprecate in 2021
  (ctrl.blog review, Dec 2020; current status UNVERIFIED). Our E2E test asserts there is no cookie or `Set-Cookie`.
- *What it collects:* the beacon reads the browser Performance API (load timings, Core Web Vitals) plus page URL,
  referrer, UA and country derived from IP. Cloudflare says IPs are not stored (secondary sources, M).
  - The FAQ says query strings are not logged "to avoid collecting potentially sensitive data" (H). We also strip
    them before the beacon loads (spec).
  - Visits count page views with an external or empty referrer (ctrl.blog, M).
  - Retention: the 2020 review said 7 days; the current dashboard window is UNVERIFIED.
- *Endpoints:* the script is `https://static.cloudflareinsights.com/beacon.min.js`. A manual (non-proxied) install
  reports to `https://cloudflareinsights.com/cdn-cgi/rum`. CSP needs `script-src …/beacon.min.js` and
  `connect-src cloudflareinsights.com` (developers.cloudflare.com/web-analytics/faq, H). Non-proxied sites are the
  primary use case (FAQ, H).
- **SRI (key finding, H):** the FAQ says that with a manual snippet "there is no current way to safely apply an
  `integrity` attribute because we do not support version-pinning our beacon script". Cloudflare updates the file in
  place for security and bug fixes, and community threads report SRI mismatches. **A hard-coded SRI hash on the CF
  URL will break, failing closed, whenever Cloudflare ships an update.** Only Cloudflare's automatic injection, which
  needs its proxy, adds a matching integrity attribute. That path is excluded.
- *Self-hosting:* no Cloudflare document permits or forbids serving a copy of `beacon.min.js` from our own origin.
  Third-party proxies exist (Workers, PHP), but redistribution rights are **UNVERIFIED**, so we must ask Cloudflare
  (task 3.2).
- *DNT/GPC:* the FAQ doesn't mention either (H). The 2020 review said DNT was honoured (UNVERIFIED today). We suppress
  the beacon ourselves (spec).
- *DPA, sub-processors and location:*
  - Cloudflare's DPA is at cloudflare.com/cloudflare-customer-dpa (v6.4, effective 3 Apr 2026, per secondary source:
    M). It uses the EU-US DPF plus SCCs (cloudflare.com/cloudflare-customer-scc).
  - Sub-processors: cloudflare.com/gdpr/subprocessors.
  - Metadata is processed in Cloudflare's US and EU data centres (Cloudflare GDPR FAQ / trust hub, M). EU-only
    storage needs the Data Localization Suite, an Enterprise add-on (M), so **assume US storage**.
  - Cloudflare, Inc. is a US company. Free plan.

**Decision: how the SRI pin is achieved.**
- **D4a, preferred if Cloudflare permits redistribution:** self-host a reviewed copy as
  `/assets/cf-beacon.<sha384-prefix>.js`, loaded with `integrity` + `crossorigin` (same-origin SRI is still checked).
  `script-src` stays `'self'`; only `connect-src https://cloudflareinsights.com` is added on `/`. Updates never break
  silently: we choose when to adopt one.
- **D4b, fallback:** load `https://static.cloudflareinsights.com/beacon.min.js` with a committed SHA-384 integrity
  hash. When Cloudflare updates the file, browsers refuse it and analytics stops; the page is unaffected.
- **Both paths:**
  - a weekly CI drift job (`.github/workflows/beacon-drift.yml`: read-only, no secrets) fetches the live file,
    compares its hash with `apps/web/analytics/beacon.lock.json`, and fails with both hashes;
  - a reviewer (SR) diffs the de-minified old and new files, checking for new storage, DOM, `eval` or network sinks,
    then bumps the lock;
  - a CI unit test asserts the `integrity` attribute is present and matches the lock.
- **Trusted Types:** the landing CSP keeps `require-trusted-types-for 'script'`. If the beacon uses a DOM sink it will
  be blocked; E2E task 4.5 detects this. We would not loosen Trusted Types for analytics (UNVERIFIED that the beacon
  is TT-clean).
- **Configuration:** `data-cf-beacon='{"token":"<site token>","spa":false}'` on a script element created by
  `src/landing/analytics.ts` after the GPC/DNT/host gate. The token is public by design and lives in `.env` as
  `VITE_CF_BEACON_TOKEN`.

**Same-origin threat (H, our analysis):** `/` and `/app/` share an origin, so third-party code on the landing page is
not isolated from the app. Two attack paths and their mitigations:
1. A ceremony started on `/` (phishing a key tap to harvest PRF outputs for the RP ID) → the landing Permissions-Policy
   disables WebAuthn.
2. `window.open('/app/')` and then scripting the opened same-origin window → the app refuses to initialise when
   `window.opener` is non-null. `frame-ancestors 'none'` already blocks framing.

Integrity pinning means only reviewed bytes run at all. Moving the landing page to its own origin (e.g.
`www.cryoshield.app`) would remove this class entirely. It is out of scope and recorded as a founder option.

*Rejected:* Plausible (the previous recommendation) was superseded by the founder decision; it remains the fallback if
Cloudflare refuses self-hosting *and* the D4b failure mode proves unacceptable.

### D5. Consent posture for the landing analytics
- No cookies or storage are set by us or (per Cloudflare) by the beacon. But the beacon **reads device information**:
  Performance API timings, screen and navigation data, the URL and the referrer. Under EDPB Guidelines 2/2023 v2
  para 32 that is "gaining access" (ePrivacy Art. 5(3)), more clearly than a constant-only payload would be (H for
  the guideline, M for application).
- Cover is partial:
  - the CNIL audience-measurement exemption requires publisher-only, anonymous statistics with no transfer to third
    parties for their own purposes (cnil.fr sheet n°16). Cloudflare as a US processor under a DPA can fit that, but it
    is not on any CNIL list;
  - the UK DUAA 2025 statistical exception (in force 5 Feb 2026 per secondary sources, UNVERIFIED);
  - performance measurement is arguably "strictly necessary" only for the publisher, not for the user.
- **Posture:** no banner. Disclose on `/privacy` and `/cookies`, honour GPC/DNT, landing only, **needs lawyer review**
  (`add-privacy-and-compliance` D5). If counsel disagrees for the EU, the cheapest compliant option is to skip the
  beacon for EU/UK timezones or locales (no geo-IP needed) or to add a one-click opt-in on the landing page.
- **A banner becomes necessary** if we add cookies or storage, cross-site identifiers, a second vendor, campaign
  attribution, Cloudflare proxying, or any analytics outside `/`.

## Risks / Trade-offs

- [Cloudflare updates the beacon → SRI rejects it (D4b)] → fail-closed by design; the drift job alerts and SR reviews and bumps. An analytics gap of days is acceptable.
- [Malicious or compromised beacon on a same-origin page] → integrity-pinned reviewed bytes, no WebAuthn on `/`, the app refuses a same-origin opener, no Cloudflare origin in the app CSP.
- [Analytics leaks into `/app/` through a shared chunk] → `verify-build` module-graph scan (task 4.2) and the E2E network log (task 4.5).
- [Meta CSP and HTTP CSP disagree] → the container test compares the header with the meta tag per document.
- [Beacon reads more than we would choose] → disclosed; query and fragment stripped first; lawyer review of the consent posture.
- [US data location] → DPF + SCCs in the DPA; disclosed as an international transfer.
- [Public metrics reveal adoption] → accepted; on-chain data is public anyway.
- [Pimlico paymaster address changes] → `paymasters.json` with sources; unknown paymasters are reported separately.
- [`eth_getLogs` limits] → reuse the recovery tool's adaptive paging; consider a public indexer on mainnet (D1).
- [Ad-blockers block `cloudflareinsights.com`] → accepted undercount. Product truth comes from on-chain data.

## Migration Plan

Groups 1–2 (metrics) ship independently. Groups 3–5 ship in one deploy together with the legal pages from
`add-privacy-and-compliance` (both are before public launch). Rollback: remove `VITE_CF_BEACON_TOKEN` and the landing
CSP additions, then redeploy. The gate then never inserts the beacon.

## Open Questions

- Does Cloudflare permit serving a copy of `beacon.min.js` first-party (D4a vs D4b)? Asked in task 3.2. Either answer fits the specs.
- Pimlico's OP Sepolia and OP Mainnet paymaster addresses for `paymasters.json` (task 1.5).

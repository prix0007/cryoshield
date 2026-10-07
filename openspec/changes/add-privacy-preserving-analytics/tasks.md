# Tasks

Owners: **FE** = frontend-engineer, **SR** = security-reviewer, **OW** = overwatcher, **F** = founder.
Phases: **P1** = before public launch. Groups 3–6 (landing analytics) are P1 and ship in the same deploy as the legal
pages from `add-privacy-and-compliance` (its group 3). Groups 1–2 (metrics) can start now and are not launch-blocking.
`redesign-landing-and-app-ui` is merged, so nothing else blocks this change.

## 1. Metrics CLI: chain metrics (FE, can start now)

- [x] 1.1 Scaffold `tools/metrics` (TS, Node 22, viem already in the lockfile, MIT) reading presets from `config/chain-presets.json` and the registry from `contracts/deployments/<chainId>.json`; verify `pnpm --filter @cryoshield/metrics test` runs an empty suite in CI's existing `web`-style job
- [x] 1.2 Test first: chain-ID mismatch exits non-zero before any `eth_getLogs` (spec "Chain ID mismatch refused"), then implement the preset/RPC loader with the adaptive block-range paging used by `tools/recover/chain.py`
- [x] 1.3 Test first on a local anvil fixture (3 vaults with 2/2/3 keys, two updates in one week): totals, weekly creates/updates, keys-per-vault from blob key count N, weekly active vaults (spec "Known fixture"); then implement
- [x] 1.4 Test first: report scan finds no 20/32-byte hex except the registry, and buckets under 3 on public chains print `"<3"` (spec "No identifiers in the report", "Small-cell suppression"); then implement the report writer
- [x] 1.5 Test first: sponsored gas = sum of `UserOperationEvent.actualGasCost` where `sender` ∈ vault owners and `paymaster` ∈ configured sponsor paymasters, excluding an unsponsored fixture op; then implement. Record Pimlico's OP Sepolia paymaster address(es) in `tools/metrics/paymasters.json` with the source URL
- [x] 1.6 Document usage in `tools/metrics/README.md` and verify the documented command reproduces the fixture report

## 2. Mirror coverage and scheduled run (FE, OW; can start now)

- [x] 2.1 Test first with a mocked GraphQL gateway: coverage counts only items whose tags match vaultId and latest version AND whose data keccak256 equals the on-chain blobHash (spec "Missing mirror", "Wrong bytes do not count"); then implement with the 1024-byte streamed cap the web app's self-heal uses
- [ ] 2.2 Add `.github/workflows/metrics.yml` (weekly cron + manual dispatch, `permissions: contents: read`, SHA-pinned actions, no secrets, `actions/upload-artifact` with 90-day retention); verify the `workflow-lint` job (zizmor) passes and a test asserts no `secrets.` reference
- [ ] 2.3 OW: run it once on OP Sepolia via `workflow_dispatch` and verify the artifact contains only aggregates
- [ ] 2.4 F: monthly, export Pimlico dashboard spend for the sponsorship policy and reconcile it with the on-chain gas total in `docs/metrics/sponsorship-log.md` (USD bill vs ETH gas; note Pimlico's surcharge); verify the first entry exists

## 3. Vendor setup (P1, F)

- [ ] 3.1 F: create a Cloudflare account and a Web Analytics site for `cryoshield.app` with the **manual JS snippet** (no proxy, no DNS change), accept Cloudflare's DPA (cloudflare.com/cloudflare-customer-dpa), and record the token in `apps/web/.env` as `VITE_CF_BEACON_TOKEN`; verify the sub-processor list (`add-privacy-and-compliance` 2.3) has the Cloudflare row with DPA and sub-processor links
- [ ] 3.2 F: ask Cloudflare in writing whether a reviewed copy of `beacon.min.js` may be served from our own origin (design D4a), and file the answer in `docs/compliance/vendors/cloudflare.md`; verify design D4 records the chosen path (D4a self-hosted or D4b CF-hosted)

## 4. Beacon loader, pinning and per-route CSP (P1, FE)

- [x] 4.1 Test first (unit): `src/landing/analytics.ts` inserts no script element when GPC is true, DNT is `"1"`, the host isn't the production host, the token is unset, or the build is dev/E2E; otherwise it first calls `history.replaceState` to drop the query and fragment, then inserts one script with `integrity`, `crossorigin="anonymous"`, and `data-cf-beacon` containing `"spa":false` (spec "GPC set", "DNT set", "Query parameters stripped"); then implement it and call it only from the landing entry
- [x] 4.2 Test first (`verify-build`): no file reachable from `app/index.html` contains `cloudflareinsights`, the beacon file name or the token, while the landing entry does (spec "App bundle contains no analytics code"); then add the check
- [x] 4.3 Test first: `apps/web/analytics/beacon.lock.json` holds `{url, sha384, reviewedBy, reviewedAt}`, and a unit test fails if the emitted `integrity` differs from the lock. For D4a, the build copies the vendored file to `/assets/` and the test recomputes its hash (spec "Integrity-pinned beacon"); then implement
- [x] 4.4 Test first (`vite-plugins/csp.ts` + `deploy/test/gen-context.test.ts` + `container.test.ts`):
  - the landing CSP = the app CSP + `https://cloudflareinsights.com` in `connect-src` (+ the beacon URL in `script-src` for D4b only);
  - the generator refuses any other difference;
  - `/` and `/index.html` get the landing CSP and a Permissions-Policy with `publickey-credentials-get=()` and `publickey-credentials-create=()`;
  - `/app`, `/app/`, `/app/index.html`, `/privacy`, `/cookies`, `//`, `/App/`, an unknown path and a 404 get the unchanged app CSP (spec `landing-page` scenarios, "Ceremony blocked on landing");
  - then implement the per-route header blocks
- [x] 4.5 Test first (Playwright):
  - `/app/` create, unlock and update flows make zero requests to Cloudflare origins;
  - landing → `/app/` sends nothing after navigation;
  - no cookies, storage or `Set-Cookie`;
  - captured beacon bodies contain no `abc`, `utm_source` or `frag`;
  - a hash-mismatched beacon is refused with the page intact;
  - blocked origins leave the page working;
  - no Trusted Types violation from the beacon (spec scenarios under "Analytics confined to the landing document", "No URL parameters or identifiers sent", "Hash mismatch fails closed", "Blocked endpoint");
  - then make them pass
- [x] 4.6 Test first (UI + E2E): the app shows "Open CryoShield directly" and makes no WebAuthn, bundler or RPC call when `window.opener` is non-null (spec "Opened from the landing page by script"); then implement in the app boot
- [ ] 4.7 OW: add `.github/workflows/beacon-drift.yml` (weekly, read-only, no secrets, SHA-pinned actions). It fetches `beacon.min.js`, compares SHA-384 with the lock, and fails with both hashes (spec "Drift detected"). Document the SR review-and-bump procedure in `apps/web/analytics/README.md`; verify that zizmor passes and a manual dispatch run succeeds against the current lock

## 5. Disclosure (P1, FE; with `add-privacy-and-compliance` group 3)

- [x] 5.1 Add the Cloudflare Web Analytics sections to `/privacy` and `/cookies`: vendor, role, US/EU processing, fields read (path, referrer, UA, Performance API timings, IP in transit), no cookies, GPC/DNT suppression, landing only. Add the device-storage inventory row. Verify the `verify-build` drift check (spec "Policy drift check") passes, and fails when the origin is removed from either page in a fixture

## 6. Review and integration (SR, OW)

- [x] 6.1 SR: security review of the CSP split, the beacon loader and pinning, the reviewed beacon bytes, the landing Permissions-Policy, the opener guard, and the Caddy matchers (path normalisation, `/app` vs `/app/` vs `/App/`, `/index.html`), recorded in `apps/web/docs/security-review-analytics.md`; verify all findings are fixed or accepted
- [ ] 6.2 OW: deploy, then verify `curl -sI https://cryoshield.app/` vs `/app/` CSP and Permissions-Policy headers, and a live browser network log on `/app/` with zero Cloudflare requests
- [ ] 6.3 F: after 30 days, confirm the dashboard shows no query strings or fragments in paths; record in `docs/metrics/sponsorship-log.md`
- [ ] 6.4 OW: when `add-fly-hosting` is archived, reconcile `web-hosting` with the per-route CSP requirement and verify `openspec validate --all --strict` passes

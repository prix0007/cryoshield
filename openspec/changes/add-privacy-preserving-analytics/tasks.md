# Tasks

Owners: **FE** = frontend-engineer, **SR** = security-reviewer, **OW** = overwatcher, **F** = founder.
Groups 1–2 can start now. Groups 3–6 are **blocked on `redesign-landing-and-app-ui`** (branch `feat/ui-redesign`)
being merged, and group 5 also on `add-privacy-and-compliance` group 3 (the `/privacy` page).

## 1. Metrics CLI: chain metrics (FE, can start now)

- [ ] 1.1 Scaffold `tools/metrics` (TS, Node 22, viem already in the lockfile, MIT) reading presets from `config/chain-presets.json` and the registry from `contracts/deployments/<chainId>.json`; verify `pnpm --filter @cryoshield/metrics test` runs an empty suite in CI's existing `web`-style job
- [ ] 1.2 Test first: chain-ID mismatch exits non-zero before any `eth_getLogs` (spec "Chain ID mismatch refused"), then implement the preset/RPC loader with the adaptive block-range paging used by `tools/recover/chain.py`
- [ ] 1.3 Test first on a local anvil fixture (3 vaults with 2/2/3 keys, two updates in one week): totals, weekly creates/updates, keys-per-vault from blob key count N, weekly active vaults (spec "Known fixture"); then implement
- [ ] 1.4 Test first: report scan finds no 20/32-byte hex except the registry, and buckets under 3 on public chains print `"<3"` (spec "No identifiers in the report", "Small-cell suppression"); then implement the report writer
- [ ] 1.5 Test first: sponsored gas = sum of `UserOperationEvent.actualGasCost` where `sender` ∈ vault owners and `paymaster` ∈ configured sponsor paymasters, excluding an unsponsored fixture op; then implement. Record Pimlico's OP Sepolia paymaster address(es) in `tools/metrics/paymasters.json` with the source URL
- [ ] 1.6 Document usage in `tools/metrics/README.md` and verify the documented command reproduces the fixture report

## 2. Mirror coverage and scheduled run (FE, OW; can start now)

- [ ] 2.1 Test first with a mocked GraphQL gateway: coverage counts only items whose tags match vaultId and latest version AND whose data keccak256 equals the on-chain blobHash (spec "Missing mirror", "Wrong bytes do not count"); then implement with the 1024-byte streamed cap the web app's self-heal uses
- [ ] 2.2 Add `.github/workflows/metrics.yml` (weekly cron + manual dispatch, `permissions: contents: read`, SHA-pinned actions, no secrets, `actions/upload-artifact` with 90-day retention); verify the `workflow-lint` job (zizmor) passes and a test asserts no `secrets.` reference
- [ ] 2.3 OW: run it once on OP Sepolia via `workflow_dispatch` and verify the artifact contains only aggregates
- [ ] 2.4 F: monthly, export Pimlico dashboard spend for the sponsorship policy and reconcile it with the on-chain gas total in `docs/metrics/sponsorship-log.md` (USD bill vs ETH gas; note Pimlico's surcharge); verify the first entry exists

## 3. Vendor setup (F; blocked on redesign merge for go-live only)

- [ ] 3.1 F: create the analytics site for `cryoshield.app` with the vendor chosen in design D4, sign or accept its DPA, enable IP-anonymised/no-IP settings, disable any optional features that store identifiers; record the DPA link in the sub-processor list (`add-privacy-and-compliance` 2.3)
- [ ] 3.2 F: confirm (or reject) design D4's assumptions in writing: data location, retention, that the event API accepts first-party POSTs without the vendor script; record answers in design.md Open Questions

## 4. Landing client and per-route CSP (FE; blocked on `redesign-landing-and-app-ui`)

- [ ] 4.1 Test first (unit): the client builds an event with `name`, `domain`, the constant `url = https://<host>/` and nothing read from the device (no query, fragment, referrer or screen data), and sends nothing when GPC is true, DNT is `"1"`, the host is not the production host, or the build is dev/E2E (spec "Query parameters stripped", "Referrer not sent", "GPC set", "DNT set"); then implement `src/landing/analytics.ts` (~40 lines, `fetch` with `keepalive`, `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, one attempt, errors swallowed silently without console)
- [ ] 4.2 Test first (`verify-build`): no file in the `/app` entry's module graph contains the analytics marker or origin; the landing entry does (spec "App bundle contains no analytics code"); then add the check
- [ ] 4.3 Test first (`vite-plugins/csp.ts` unit): two CSPs are emitted, landing = app + exactly one origin in `connect-src`, `script-src 'self'` in both; then implement
- [ ] 4.4 Test first (`deploy/test/container.test.ts`): `/` gets the landing CSP; `/app`, `/app/`, `/privacy`, an unknown path and a 404 get the unchanged app CSP (spec "Landing CSP", "App CSP unchanged"); then implement per-route `header` blocks in `deploy/gen-context.mjs` keyed on exact path matchers, with the app CSP as the default
- [ ] 4.5 Test first (Playwright): network log on `/app` create/unlock flows shows zero requests to the analytics origin; landing → `/app` navigation sends exactly one event; no cookies or storage; blocked endpoint leaves the page working (spec scenarios under "Analytics confined to the landing route", "No storage or cookies", "Blocked endpoint"); then wire the client into the landing entry only

## 5. Disclosure (FE; blocked on `add-privacy-and-compliance` group 3)

- [ ] 5.1 Add the analytics section to `/privacy` (vendor, location, fields, IP/UA seen in transit, retention, GPC/DNT, `/app` excluded) and the vendor row to the sub-processor list; verify the `verify-build` drift check (spec "Policy drift check") passes, and fails when the origin is changed in a test fixture

## 6. Review and integration (SR, OW)

- [ ] 6.1 SR: security review of the CSP split, the client, and the Caddy matchers (path normalisation, `/app` vs `/app/` vs `/App`, `/index.html`), recorded in `apps/web/docs/security-review-analytics.md`; verify all findings are fixed or accepted
- [ ] 6.2 OW: deploy, then verify `curl -sI https://cryoshield.app/` vs `/app` CSP headers and a live browser network log on `/app` with zero vendor requests
- [ ] 6.3 F: after 30 days, confirm the dashboard shows only page-view counts plus the country and device class Plausible derives from IP/UA, and no referrer or URL parameters; record in `docs/metrics/sponsorship-log.md`
- [ ] 6.4 OW: when `add-fly-hosting` is archived, reconcile `web-hosting` with the per-route CSP requirement and verify `openspec validate --all --strict` passes

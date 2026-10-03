# Tasks

Owners: **F** = founder, **L** = external lawyer (India + EU/UK privacy), **FE** = frontend-engineer, **SR** =
security-reviewer, **OW** = overwatcher, **CE** = crypto-engineer, **SE** = solidity-engineer, **RE** =
recovery-engineer. Phases: **P1** = before public launch (testnet), **P2** = before mainnet (and in any case by
~13 May 2027 for DPDP), **P3** = before SOC 2 Type I.

## 1. Founder inputs (P1, F)

- [ ] 1.1 F: record the legal entity name, CIN and registered address, and name the Grievance Officer, in `docs/compliance/entity.md`; verify the file has all four fields
- [ ] 1.2 F: choose a mail provider and create `privacy@`, `security@` and `grievance@cryoshield.app` (MX, SPF, DKIM, DMARC); verify with a test email to each and record the provider in the sub-processor list
- [ ] 1.3 F: sign Fly's DPA (fly.io/documents) and email Pimlico (dpo@pimlico.io) for a DPA and their log retention for IP, sender and userOps; ask Fly for edge-proxy log retention; verify the replies are filed in `docs/compliance/vendors/`
- [ ] 1.4 F: engage L for a light P1 review of the pages and a P2 opinion pack (task 7.1); verify the engagement letter lists the D2–D4 **[lawyer]** items

## 2. Inventory and records (P1, OW + SR)

- [ ] 2.1 Write `docs/compliance/data-inventory.md` from design D1 (12 rows, PD class, role, retention, sources) and add a machine-readable `docs/compliance/origins.json` mapping each `connect-src` origin to its row; verify SR reviews it against the built CSP
- [ ] 2.2 Test first: `verify-build` fails on a fixture build whose `connect-src` has an origin missing from `origins.json` (spec "New origin without inventory entry"); then implement and verify the production build passes and prints each origin with its role
- [ ] 2.3 Write `docs/compliance/subprocessors.md` (D10) and `docs/compliance/retention.md` (D8); verify every inventory vendor row appears in both
- [ ] 2.4 Write `docs/compliance/risk-register.md` + DPIA-lite (D9) with F's residual-risk sign-off; verify every risk has an owner and a score
- [ ] 2.5 Write `docs/compliance/legal-analysis.md` (D2–D5 with sources, confidence and **[lawyer]** flags); verify each UNVERIFIED item has a matching question in the L pack (7.1)

## 3. Legal pages (P1, FE; text by F + L)

- [ ] 3.1 Draft `/privacy`, `/terms` and `/cookies` in-repo (`apps/web/legal/privacy.md`, `terms.md`, `cookies.md`) from the D6 outlines. Keep the placeholders `[ENTITY]`, `[REGISTERED ADDRESS]`, `[GRIEVANCE OFFICER]` and `[CONTACT EMAIL]` verbatim and show the "Draft, pending legal review" banner. Include the Cloudflare Web Analytics disclosure (privacy + cookies) and the device-storage inventory table. Verify L's light-review comments are resolved in the PR
- [ ] 3.2 Test first: build test checks the required headings and effective date on `/privacy` and `/cookies`, the Analytics section (spec "Required sections present", "Analytics disclosed"), and links to all three pages from the landing page, app shell and each legal page (spec "Linked everywhere"); then render the pages as static HTML with the app CSP and no third-party resources
- [ ] 3.3 Test first (`verify-build`): fail when a placeholder token remains on a page without the draft banner (spec "Banner while placeholders remain"); then implement it
- [ ] 3.4 Test first (Playwright): the three pages make only same-origin requests (spec "No third-party requests"); a storage sweep of `/` (beacon allowed), the `/app/` create/unlock flow and each legal page equals the published inventory (spec "Inventory matches reality"); then make them pass
- [ ] 3.5 Test first: a CI check fails when legal source text changes without an effective-date change (spec "Date changes with content"); then implement in `scripts/`
- [ ] 3.6 SR: check every security claim on the three pages against `openspec/specs` and the reviews; verify a sign-off line in `docs/compliance/review-log.md`
- [ ] 3.7 F: once the entity, Grievance Officer and mailbox exist (1.1, 1.2) and L signs off, replace the placeholders and remove the banner; verify `verify-build` passes with no placeholder tokens

## 4. In-app acknowledgements (P1, FE)

- [ ] 4.1 Test first (UI + E2E): the save button stays disabled, and no bundler, paymaster or Turbo request is made, until both the permanence acknowledgement and the 18+ confirmation are ticked (spec "Cannot create without acknowledging", "Under-18 path"); then implement in the create flow, with copy listing the public fields (address, locators, key count, credential IDs, ciphertext)
- [ ] 4.2 Extend `test/privacy.test.ts` and E2E: the acknowledgement leaves no cookie, storage or request field (spec "Acknowledgement is not stored", "Full flow leaves nothing behind"); verify green
- [ ] 4.3 Show the testnet + unaudited warning in the app shell when the chain is a testnet (spec "Testnet warning present"); verify with a UI test for chain 11155420

## 5. Security contact and disclosure (P1, OW + SR)

- [ ] 5.1 Test first: `verify-build` fails when `security.txt` `Expires` is past or >365 days ahead (spec "Expiry guard"); container test expects 200, `text/plain; charset=utf-8` and the canonical line (spec "Served as text"); then add `apps/web/public/.well-known/security.txt` (D7) and a Caddy MIME rule if needed
- [ ] 5.2 Write `SECURITY.md` (scope, safe harbour, 72 h ack / 7 d triage / 90 d disclosure); OW enables GitHub private vulnerability reporting; verify by opening a test draft advisory
- [ ] 5.3 SR: replace the README's "report privately to the maintainers" line with links to `SECURITY.md` and security.txt; verify the links resolve

## 6. Hosting logs and incident response (P1, OW + F)

- [ ] 6.1 Test first (`deploy/test/container.test.ts`): serve 100 requests with distinct `Fly-Client-IP`s, user agents and query strings, and assert that none appears in container output (spec "Default server config logs nothing identifying"); keep the generated Caddyfile free of `log`
- [ ] 6.2 Write `docs/compliance/incident-runbook.md` (D11: severities, SEV1 steps, the clocks table, pre-filled CERT-In form, public-notice templates, "we never ask for keys" line); verify F and SR sign it
- [ ] 6.3 Write `docs/compliance/erasure-procedure.md` (D3: what is deleted, what can't be, `ykman fido reset` crypto-shredding steps, reply templates, SLAs); CE verifies the crypto-shredding statement matches `docs/spec/vault-format-v1.md`; RE verifies the desktop tool sends no telemetry
- [ ] 6.4 Start `docs/compliance/review-log.md` with the first dated review; set up a monthly export of Fly, GitHub, Pimlico and DNS audit logs to an India-resident company drive (D8); verify the first export exists

## 7. Before mainnet (P2, F + L + SR + SE/CE)

- [ ] 7.1 L: written opinions on (a) GDPR/DPDP status of on-chain ciphertext, locators and addresses, plus the lawful basis; (b) PMLA/VDA and FIU-IND for the USD-billed paymaster; (c) whether CERT-In 180-day or DPDP Rule 8(3) logs require request logs; (d) Art. 27 EU/UK representative; (e) IT Act intermediary status; (f) DPDP Rule 7 notice without contact channels; verify each answer is recorded in `legal-analysis.md` and any spec or wording change is filed as an OpenSpec change
- [ ] 7.2 F + L: full DPIA (EDPB 02/2025 v2 paras 91, 98–99); verify it is signed and linked from the risk register
- [ ] 7.3 SE + CE: options paper on on-chain minimisation (drop cleartext credential IDs, etc.; D3) with cost to keyless recovery; verify an accept/reject decision in the PRD decisions log
- [ ] 7.4 F: sanctions decision (ToS-only vs advisory oracle check vs geoblock; D4); if the oracle check is chosen, FE confirms the oracle's OP Mainnet address on an explorer and files an OpenSpec change
- [ ] 7.5 F + SR + OW: tabletop "malicious bundle served from cryoshield.app" (spec "Tabletop exercise"); verify the exercise log and issues filed
- [ ] 7.6 Test first: a CI check fails when a mainnet `contracts/deployments/<id>.json` is added without a `mainnet-gate` review-log entry dated within 30 days (spec "Mainnet gate"); then implement
- [ ] 7.7 F: by ~13 May 2027, confirm the DPDP Rule 3 notice, Rule 7 breach process and Rule 8(3) log retention are in place, whether or not mainnet has shipped; verify a review-log entry

## 8. Before SOC 2 Type I (P3, F + OW)

- [ ] 8.1 F: write the policy set (information security, access control, change management, vendor management, incident response, BCP/DR, data retention, acceptable use) reusing tasks 2–6; verify each maps to the TSC table in design D13
- [ ] 8.2 F: onboard Vanta or Drata, collect vendor SOC 2 reports (Fly, GitHub; ask Pimlico), and complete two six-monthly reviews; verify the readiness dashboard shows no unmapped CC criteria
- [ ] 8.3 OW: when `add-web-app` and `add-fly-hosting` are archived, reconcile `vault-web-app` and `web-hosting` with this change's requirements; verify `openspec validate --all --strict`

## 9. Security review (SR)

- [ ] 9.1 SR: review the P1 deliverables as shipped (pages, acknowledgements, security.txt, no-log test, inventory check, runbook) for accuracy of security claims, CSP and header regressions, and abuse paths in design D14; record in `apps/web/docs/security-review-compliance.md` and verify every finding is fixed or explicitly accepted by F

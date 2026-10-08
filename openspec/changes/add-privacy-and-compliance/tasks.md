# Tasks

Owners: **M** = maintainer (founder), **FE** = frontend-engineer, **SR** = security-reviewer, **OW** = overwatcher,
**CE** = crypto-engineer, **SE** = solidity-engineer, **RE** = recovery-engineer. Phases: **P1** = before public
launch (testnet), **P2** = before mainnet.

**Rescope (founder decision 2026-10-08, verbatim: "It's OSS so no company and legal").** CryoShield is an open-source
project maintained by its contributors, with no legal entity, no company and no lawyer engagement. Tasks that assumed
one are ticked with "N/A (OSS, founder 2026-10-08)" and a one-line reason; they are kept for the record. See design
"Rescope".

## 1. Founder inputs (P1, M)

- [x] 1.1 ~~M: record the legal entity name, CIN and registered address, and name the Grievance Officer, in `docs/compliance/entity.md`~~ — N/A (OSS, founder 2026-10-08): there is no entity, CIN or address; the operator and Grievance Officer ("the project maintainer") are defined by `project-contact`
- [x] 1.2 ~~M: create `privacy@`, `security@` and `grievance@cryoshield.app` mailboxes~~ — N/A (OSS, founder 2026-10-08): contact is GitHub only (issues and private security advisories); no mailbox exists or is needed
- [x] 1.3 ~~M: sign Fly's DPA and obtain a Pimlico DPA and log-retention answers~~ — N/A (OSS, founder 2026-10-08): no company signs agreements; the project relies on each vendor's **public** terms, privacy policy and DPA, listed in `docs/compliance/subprocessors.md`, with unpublished retention marked UNVERIFIED in the inventory
- [x] 1.4 ~~M: engage a lawyer for a page review and an opinion pack~~ — N/A (OSS, founder 2026-10-08): no lawyer engagement; pages carry the "not legal advice" note and invite community corrections

## 2. Inventory and records (P1, OW + SR)

- [x] 2.1 Write `docs/compliance/data-inventory.md` from design D1 and `docs/compliance/origins.json` mapping each `connect-src` origin to its row; verify SR reviews it against the built CSP. Completed 2026-10-08: 13 rows (registry v1/v2, P-256 owner keys, version history, RPC presets, recovery-tool network path, metrics job), every `origins.json` origin maps to a row; `verify-build` origin check green
- [x] 2.2 Test first: `verify-build` fails on a fixture build whose `connect-src` has an origin missing from `origins.json` (spec "New origin without inventory entry"); then implement and verify the production build passes and prints each origin with its role
- [x] 2.3 Write `docs/compliance/subprocessors.md` (D10) and `docs/compliance/retention.md` (D8); verify every inventory vendor row appears in both
- [x] 2.4 Write `docs/compliance/risk-register.md` (D9, lite) with a maintainer residual-risk sign-off line; verify every risk has an owner and a score. Done: 16 risks scored and owned; the sign-off line is left for the maintainer
- [x] 2.5 Write `docs/compliance/legal-analysis.md` as a factual "how the design limits personal data" (D2), with no legal conclusions; verify every open question is listed in its "Open questions" section. Done (§9, seven questions)

## 3. Legal pages (P1, FE; text by M)

- [x] 3.1 Draft `/privacy`, `/terms` and `/cookies` in-repo (`apps/web/legal/privacy.md`, `terms.md`, `cookies.md`) from the D6 outlines, including the Cloudflare Web Analytics disclosure and the device-storage inventory table. Done; operator, contact and the not-legal-advice note per `project-contact`; claims corrected in 3.6
- [x] 3.2 Test first: build test checks the required headings and effective date on `/privacy` and `/cookies`, the Analytics section (spec "Required sections present", "Analytics disclosed"), and links to all three pages from the landing page, app shell and each legal page (spec "Linked everywhere"); then render the pages as static HTML with the app CSP and no third-party resources
- [x] 3.3 Test first (`verify-build`): fail when a placeholder token remains on a page without the draft banner; then implement it. Superseded by `project-contact` "No placeholders or project mailboxes in shipped files" (no placeholder may ship at all)
- [x] 3.4 Test first (Playwright): the three pages make only same-origin requests (spec "No third-party requests"); a storage sweep of `/` (beacon allowed), the `/app/` create/unlock flow and each legal page equals the published inventory (spec "Inventory matches reality"); then make them pass
- [x] 3.5 Test first: a CI check fails when legal source text changes without an effective-date change (spec "Date changes with content"); then implement in `scripts/`
- [x] 3.6 SR: check every security claim on the three pages against `openspec/specs` and the reviews; verify a sign-off line in `docs/compliance/review-log.md`. Done 2026-10-08: nine inaccuracies fixed (PIN needed to unlock, vault names encrypted, full public-field list incl. registry, P-256 keys and history, memory and auto-lock, statistics job, missing changelog entries); recorded in the review log's first entry
- [x] 3.7 ~~M: replace the placeholders and remove the draft banner once the entity, Grievance Officer, mailbox and lawyer sign-off exist~~ — N/A (OSS, founder 2026-10-08): those inputs will never exist; the placeholders and banner were already removed by `adopt-oss-project-defaults`, and `verify-build` refuses any placeholder

## 4. In-app acknowledgements (P1, FE)

- [x] 4.1 Test first (UI + E2E): the save button stays disabled, and no bundler, paymaster or Turbo request is made, until both the permanence acknowledgement and the 18+ confirmation are ticked (spec "Cannot create without acknowledging", "Under-18 path"); then implement in the create flow, with copy listing the public fields (address, locators, key count, credential IDs, ciphertext)
- [x] 4.2 Extend `test/privacy.test.ts` and E2E: the acknowledgement leaves no cookie, storage or request field (spec "Acknowledgement is not stored", "Full flow leaves nothing behind"); verify green
- [x] 4.3 Show the testnet + unaudited warning in the app shell when the chain is a testnet (spec "Testnet warning present"); verify with a UI test for chain 11155420

## 5. Security contact and disclosure (P1, OW + SR)

- [x] 5.1 Test first: `verify-build` fails when `security.txt` `Expires` is past or >365 days ahead (spec "Expiry guard"); container test expects 200, `text/plain; charset=utf-8` and the canonical line (spec "Served as text"); then add `apps/web/public/.well-known/security.txt` (D7) and a Caddy MIME rule if needed
- [x] 5.2 Write `SECURITY.md` (scope, safe harbour, 72 h ack / 7 d triage / 90 d disclosure) through GitHub private vulnerability reporting; verify reporting is enabled. Done: `SECURITY.md` covers all of it (scope updated 2026-10-08 for registry v2, the PIN-enforcing smart wallet and CI); `GET /repos/prix0007/cryoshield/private-vulnerability-reporting` returns `{"enabled":true}` (2026-10-08)
- [x] 5.3 SR: replace the README's "report privately to the maintainers" line with links to `SECURITY.md` and security.txt; verify the links resolve

## 6. Hosting logs and incident response (P1, OW + M)

- [x] 6.1 Test first (`deploy/test/container.test.ts`): serve 100 requests with distinct `Fly-Client-IP`s, user agents and query strings, and assert that none appears in container output (spec "Default server config logs nothing identifying"); keep the generated Caddyfile free of `log`
- [x] 6.2 Write `docs/compliance/incident-runbook.md` (D11: roles, severities, SEV1 steps with the commands from `docs/deploy.md`, public-notice channels and template, "we never ask for keys", external clocks for reference only); verify SR checks the commands. Done; maintainer sign-off line left for the maintainer
- [x] 6.3 Write `docs/compliance/erasure-procedure.md` (D3: what can be deleted, what can't, `ykman fido reset` crypto-shredding steps, reply template, 24 h / 15 d); verify the crypto-shredding statement matches `docs/spec/vault-format-v1.md` and the desktop tool sends no telemetry. Done; both checks recorded in its §5
- [x] 6.4 Start `docs/compliance/review-log.md` with the first dated review. Done (2026-10-08). The monthly audit-log export to a company drive is N/A (OSS, founder 2026-10-08): it existed only for a company's statutory log duties; each platform keeps its own audit trail

## 7. Before mainnet (P2, M + SR + SE/CE)

- [x] 7.1 ~~Lawyer: written opinions (on-chain status, PMLA/VDA, log duties, Art. 27 representative, intermediary status, Rule 7 notice)~~ — N/A (OSS, founder 2026-10-08): no lawyer engagement; the questions are kept as open questions in `legal-analysis.md` §9
- [x] 7.2 ~~M + lawyer: full DPIA~~ — N/A (OSS, founder 2026-10-08): a formal DPIA is an organisational instrument; the lite risk register (2.4) with its necessity-and-proportionality note covers the engineering content
- [x] 7.3 SE + CE: options paper on on-chain minimisation (credential IDs and the rest; D3) with costs; verify a decision entry in the PRD decisions log. Done: `docs/compliance/on-chain-minimisation-options.md` (O1–O5); PRD decisions log row "On-chain minimisation" (reject O1, O2, O4, O5; decide O3 with review F2 before the first mainnet vault)
- [x] 7.4 Sanctions stance: document the current behaviour (D4). Done: `legal-analysis.md` §6, terms-only eligibility clause, no screening, no geoblocking, bounded value; no founder decision needed for the testnet
- [x] 7.5 SR + OW: tabletop "malicious bundle served from cryoshield.app" (spec "Tabletop exercise"), on paper against the current release and rollback runbooks; verify the exercise log lists each decision with its deadline and the gaps found. Done: `docs/compliance/tabletop-2026-10-08.md`; G1 fixed in the runbook, G2–G6 listed as proposed issues for the maintainer
- [x] 7.6 Test first: a CI check fails when a mainnet `contracts/deployments/<id>.json` is added without its launch record (`docs/reviews/launch-<preset>.md`, coordinated with `launch-op-mainnet`) and a `mainnet-gate` review-log entry dated within 30 days (spec "Mainnet gate"); then implement. Done: `.github/scripts/mainnet-gate.mjs` + `test/mainnet-gate.test.mjs` (18 tests), wired into `ci.yml` `pr-checks`
- [x] 7.7 ~~M: confirm the DPDP Rule 3 notice, Rule 7 breach process and Rule 8(3) log retention by ~13 May 2027~~ — N/A (OSS, founder 2026-10-08): a legal-compliance confirmation for a Data Fiduciary entity; the user-facing notice, breach notice and no-log posture stay in place and are re-checked at every six-monthly review

## 8. Before SOC 2 Type I (dropped)

- [x] 8.1 ~~M: write the SOC 2 policy set~~ — N/A (OSS, founder 2026-10-08): SOC 2 attests an organisation; there is none
- [x] 8.2 ~~M: onboard Vanta or Drata and collect vendor SOC 2 reports~~ — N/A (OSS, founder 2026-10-08): same reason
- [x] 8.3 OW: reconcile `vault-web-app` and `web-hosting` (both archived) with this change's requirements; verify `openspec validate --all --strict`. Done 2026-10-08: no conflicting text in either spec; the acknowledgements stay in `legal-pages` and the no-log guarantee in `privacy-compliance` (design D16). The `project-contact` supersessions (adopt-oss-project-defaults D5) are applied to the `legal-pages` delta

## 9. Security review (SR)

- [x] 9.1 SR: review the P1 deliverables as shipped (pages, acknowledgements, security.txt, no-log test, inventory check, runbook) for accuracy of security claims, CSP and header regressions, and abuse paths in design D14; record in `apps/web/docs/security-review-compliance.md` and verify every finding is fixed or explicitly accepted by M
- [x] 9.2 SR: review the 2026-10-08 rescope (the mainnet-gate CI check, the legal-page corrections, the compliance records); record in `docs/compliance/review-log.md`. Done: the check is fail-closed (unknown chain ids count as mainnet), reads only repository files, needs no secret or token, and runs in `pr-checks` with `contents: read`

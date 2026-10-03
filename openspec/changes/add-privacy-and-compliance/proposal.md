# Proposal

## Why

CryoShield is about to serve real users from https://cryoshield.app. Users come from all over the world, and the
operator is an Indian legal entity. Even though CryoShield runs no backend and never sees plaintext, personal data
still flows: IP addresses reach Fly, Pimlico, RPCs and Arweave, and pseudonymous identifiers are published
**permanently** on a public chain and Arweave. The EDPB's final blockchain guidelines (02/2025 v2.0, adopted
7 Jul 2026) say that encrypted data is still personal data and advise against putting it on-chain. India's DPDP Rules
2025 phase in on ~13 Nov 2026 (Consent Managers) and ~13 May 2027 (all core duties). The site has no privacy policy,
terms, security contact, breach plan or sub-processor list today. The PRD's open GDPR question and the SOC 2 phase
(PRD Phase 7) both need this groundwork.

## What Changes

This change is mostly **documentation, process and static pages**. It adds no application logic beyond two
acknowledgement checkboxes and build checks.
- **Data-flow inventory** (`docs/compliance/data-inventory.md`): every party, the data it sees, PD classification,
  role (controller / processor / neither), retention. A `verify-build` check ties it to the production `connect-src`.
- **Legal analysis record** (`docs/compliance/legal-analysis.md`): DPDP Act + Rules, GDPR + EDPB 02/2025 v2, ePrivacy,
  CCPA/US states, COPPA, IT Act / Intermediary Rules / CERT-In, PMLA-VDA / FIU-IND, sanctions. Sources and confidence
  for each, with the gaps that need an external lawyer marked. Design D2–D4 summarise it.
- **Static pages:** `/privacy`, `/terms` and a **Cookie Policy** at `/cookies`, drafted now with placeholders
  (`[ENTITY]`, `[REGISTERED ADDRESS]`, `[GRIEVANCE OFFICER]`, `[CONTACT EMAIL]`) and a visible "Draft, pending legal
  review" banner (founder decision 2026-10-03; outlines in design D6). The cookie policy publishes a device-storage
  inventory, kept true by an E2E test, and discloses the landing-page Cloudflare Web Analytics beacon, `/.well-known/security.txt` (RFC 9116) and a responsible-disclosure policy (`SECURITY.md` + GitHub
  private vulnerability reporting).
- **In-app disclosures:** a permanence acknowledgement and an 18+ confirmation before the first vault write.
- **Operational records:** data-retention statement, DPIA-lite + risk register, sub-processor list, erasure-request
  procedure (with key destruction as crypto-shredding), incident/breach runbook with per-regime clocks, cookie/consent
  posture, and a six-monthly review log with a mainnet gate.
- **Hosting:** a tested guarantee that Caddy writes no access log; Fly platform logging documented.
- **SOC 2 mapping:** each artefact mapped to the Trust Services Criteria (Security + Confidentiality + Privacy) and
  sequenced into before-public-launch / before-mainnet / before-SOC 2 Type I.

**Out of scope:**
- final legal text (an external lawyer signs off), company registration, appointing a DPO, or an EU/UK Art. 27
  representative (founder decision after lawyer advice, see design Open Questions);
- KYC, sanctions screening code, or geoblocking (analysed in D4 and not recommended for the testnet; revisit before
  mainnet);
- the analytics implementation (separate change `add-privacy-preserving-analytics`; only its disclosure is required here);
- any change to the vault format, contracts or crypto. Moving locators or credential IDs off-chain would answer
  EDPB 02/2025 para 104 but break keyless recovery. It is recorded as a risk with a post-MVP option (D3).

**Runtime dependencies:** none added. The pages are static files served by the existing Caddy container. Email for
privacy, security and grievance requests uses a mail provider, which is a vendor and not a CryoShield backend.

## Capabilities

### New Capabilities
- `privacy-compliance`: data inventory tied to the build, no CryoShield-side identifiers, minimal hosting logs, erasure handling, breach response, and scheduled compliance reviews with a mainnet gate.
- `legal-pages`: `/privacy`, `/terms`, `security.txt`, versioned legal text, and the in-app permanence and age acknowledgements.

### Modified Capabilities
None in `openspec/specs/`. The in-app acknowledgements touch the create flow from `add-web-app` (capability
`vault-web-app`, not yet archived), and the no-access-log guarantee touches `web-hosting` (`add-fly-hosting`, not yet
archived). Both are specified here as new requirements and reconciled at archive time (task 8.3).

## Impact

- New docs: `docs/compliance/*`, `SECURITY.md`, `apps/web/public/.well-known/security.txt`, `/privacy`, `/terms` and `/cookies` pages.
- Changed: the create flow UI (two checkboxes), `scripts/verify-build.mjs` (inventory, security.txt and policy-date checks), `deploy/test/container.test.ts` (no-log test), and CI (mainnet-gate check).
- Coordination: the landing/app split comes from `redesign-landing-and-app-ui`. The pages can ship on today's single-page app and move with the redesign.
- People: founder (entity details, Grievance Officer, email, vendor DPAs), external Indian + EU privacy counsel.

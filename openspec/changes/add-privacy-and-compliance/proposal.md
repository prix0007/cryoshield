# Proposal

> **Rescoped 2026-10-08.** Founder decision, verbatim: "It's OSS so no company and legal". CryoShield is an open-source
> project maintained by its contributors. It has no legal entity, no company and no lawyer engagement; contact is
> GitHub (issues and private security advisories). This follows the 2026-10-03 "assume the best" decision applied by
> `adopt-oss-project-defaults`. Everything below that assumed a company, a lawyer, a DPIA or SOC 2 is dropped; the
> user-facing privacy commitments stay.

## Why

CryoShield serves users from https://cryoshield.app. Users come from all over the world. Even though CryoShield runs
no backend and never sees plaintext, personal data still flows: IP addresses reach Fly, Pimlico, RPCs and Arweave, and
pseudonymous identifiers are published **permanently** on a public chain and Arweave. Regulators have written about
exactly this (the EDPB's blockchain guidelines 02/2025 v2.0 say encrypted data is still personal data and advise
against putting it on-chain). Users deserve an honest account of what is public, what is not, and what can and cannot
be deleted, plus a working security contact, an incident plan and a record that keeps these true over time.

## What Changes

This change is mostly **documentation, process and static pages**. It adds no application logic beyond two
acknowledgement checkboxes and build/CI checks.
- **Data-flow inventory** (`docs/compliance/data-inventory.md`): every party, the data it sees, whether it identifies
  a person, who chose it and who controls it, and retention. A `verify-build` check ties it to the production
  `connect-src`.
- **How the design limits personal data** (`docs/compliance/legal-analysis.md`): a factual record of the minimisation
  in the design, the sanctions stance as current behaviour, the regulatory context as reference only, and open
  questions. No legal conclusions.
- **Static pages:** `/privacy`, `/terms` and a **Cookie Policy** at `/cookies`, with the open-source operator,
  GitHub-only contact and a "not legal advice" note (`project-contact`). The cookie policy publishes a device-storage
  inventory, kept true by an E2E test, and discloses the landing-page Cloudflare Web Analytics beacon;
  `/.well-known/security.txt` (RFC 9116) and a responsible-disclosure policy (`SECURITY.md` + GitHub private
  vulnerability reporting). Every security claim on the pages is checked against the specs and review records.
- **In-app disclosures:** a permanence acknowledgement and an 18+ confirmation before the first vault write.
- **Operational records:** retention statement, lite risk register, vendor list (public terms relied on), erasure
  procedure (with key destruction as crypto-shredding), incident runbook with public user notification, a tabletop
  exercise, an on-chain minimisation options paper, and a six-monthly review log.
- **Mainnet gate (CI):** a pull request that adds a mainnet deployment record fails unless the chain's launch record
  exists (`launch-op-mainnet`) and the review log has a `mainnet-gate` entry from the last 30 days.
- **Hosting:** a tested guarantee that Caddy writes no access log; Fly platform logging documented.

**Out of scope:**
- forming a company, appointing a Grievance Officer by name, a DPO or an EU/UK representative, signing DPAs, any
  lawyer review or opinion, a formal DPIA, SOC 2 (policies, Vanta/Drata) and statutory-compliance confirmations:
  **N/A for the open-source project** (founder 2026-10-08);
- KYC, sanctions screening code, or geoblocking (the current behaviour is documented, D4);
- the analytics implementation (separate change `add-privacy-preserving-analytics`; only its disclosure is required here);
- any change to the vault format, contracts or crypto. The minimisation options (D3) are costed in a paper; any that
  is accepted gets its own OpenSpec change.

**Runtime dependencies:** none added. The pages are static files served by the existing Caddy container. Contact
uses GitHub, which already hosts the project. No CryoShield-operated backend.

## Capabilities

### New Capabilities
- `privacy-compliance`: data inventory tied to the build, no CryoShield-side identifiers, minimal hosting logs, erasure handling, incident response with public notice, and scheduled compliance reviews with a CI-enforced mainnet gate.
- `legal-pages`: `/privacy`, `/terms`, `/cookies`, `security.txt`, versioned legal text, and the in-app permanence and age acknowledgements.

### Modified Capabilities
None in `openspec/specs/`. `vault-web-app` and `web-hosting` (now archived) were checked: neither contains text that
conflicts with this change, so the acknowledgements stay in `legal-pages` and the no-log guarantee in
`privacy-compliance` (task 8.3, design D16). The `legal-pages` delta already reflects the `project-contact`
supersessions recorded by `adopt-oss-project-defaults`.

## Impact

- Docs: `docs/compliance/*`, `SECURITY.md`, `apps/web/public/.well-known/security.txt`, `/privacy`, `/terms` and `/cookies` pages.
- Changed: the create flow UI (two checkboxes), `scripts/verify-build.mjs` (inventory, security.txt and storage checks), `deploy/test/container.test.ts` (no-log test), and CI (`apps/web/scripts/check-legal-dates.mjs`, `.github/scripts/mainnet-gate.mjs` in `pr-checks`).
- Coordination: `launch-op-mainnet` writes the launch record `docs/reviews/launch-op-mainnet.md` that the mainnet gate requires, and its go/no-go G9 cites the `mainnet-gate` review-log entry.
- People: the maintainer (sign-off lines on the risk register, runbook and review log); contributors (community review of the pages).

# Proposal

## Why

The founder decided on 2026-10-03 that CryoShield is an open-source project ("this will be a OSS project so please
assume the best"), and the repository is now public. Secret scanning, push protection and private vulnerability
reporting are enabled.

The legal pages, `SECURITY.md` and `security.txt` were drafted for a company that does not exist. They show
`[ENTITY]`, `[REGISTERED ADDRESS]`, `[GRIEVANCE OFFICER]` and `[CONTACT EMAIL]` placeholders, a
"Draft, pending legal review" banner, and a `security@cryoshield.app` mailbox that does not exist either. Visitors
should see true, usable contact details, not placeholders.

## What Changes

- **Operator:** "CryoShield, an open-source project maintained by its contributors
  (github.com/prix0007/cryoshield)". No company, no registered address. The maintainers act as controller and Data
  Fiduciary for the little data that exists (GitHub correspondence); the site itself holds none.
- **Contact is GitHub only:**
  - privacy requests: a GitHub issue from a new "Privacy request" template, or a private security advisory for
    anything sensitive;
  - security reports: GitHub private vulnerability reporting.

  Every email address is removed, including `security@cryoshield.app` in `security.txt`, `SECURITY.md`, the CAA
  `iodef` suggestion and the policies.
- **Grievance Officer (DPDP):** "the project maintainer", reached through the private advisory channel, with the same
  24 h acknowledgement and 15-day resolution.
- **Honest framing kept:** testnet, unaudited, the permanence and crypto-shredding caveats, and the software provided
  "as is" under the MIT licence. The Terms mirror the licence's warranty disclaimer and limitation of liability.
- **Note instead of banner:** the draft banner is replaced by a quiet note under the effective date: "Written for an
  open-source project; not legal advice. Suggestions welcome via GitHub." The placeholder highlighting is removed.
- **New file:** `.github/ISSUE_TEMPLATE/privacy-request.yml`. It warns people never to post secrets, keys or recovery
  codes.
- **Build guard replaced:** "placeholders only under the banner" becomes "no bracket placeholder and no
  `@cryoshield.app` address in any shipped file" (verify-build + unit test).
- **Docs:** `docs/compliance` (inventory row 10, sub-processors, retention) is updated to GitHub correspondence.
- **Task notes:** the compliance tasks that assumed an entity, a lawyer or a mailbox are marked "N/A for the OSS
  project" or re-scoped, in this change's design.md. Archived files are not edited.

**Out of scope:**
- forming a legal entity;
- any vault, crypto, contract, CSP, header or analytics behaviour;
- the PRD (overwatcher-owned; its open question on entity/mailboxes is answered in design.md for the overwatcher to
  fold in).

**Runtime dependencies:** none. There is no new origin and no CryoShield-operated backend.

## Capabilities

### New Capabilities
- `project-contact`: who operates CryoShield and how to reach it. Covers the OSS operator identity on the legal pages,
  GitHub-only contact channels (no email), the Grievance Officer, the not-legal-advice note, the privacy-request issue
  template, and the no-placeholder build guard.

### Modified Capabilities
None in `openspec/specs/` (the `legal-pages` capability is still in the active `add-privacy-and-compliance` change).
design.md records which of its requirements this change supersedes, to be reconciled when that change is archived.

## Impact

- Code and content:
  - `apps/web/legal/*.md` and the three page shells;
  - `apps/web/src/legal/legal.css`;
  - `apps/web/vite-plugins/legal.ts`;
  - `apps/web/scripts/{legal-check,verify-build}.mjs`;
  - `apps/web/public/.well-known/security.txt`.
- Docs: `SECURITY.md`, `apps/web/deploy/README.md`, `docs/compliance/*`.
- New file: `.github/ISSUE_TEMPLATE/privacy-request.yml`.
- Tests: legal pages, security.txt, legal checks, E2E `08-legal`, the container test. Screenshots are regenerated.

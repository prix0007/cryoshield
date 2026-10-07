# Design

## Context

- **Founder decision (2026-10-03):** CryoShield is an open-source project: "please assume the best". The repository
  is public, with secret scanning, push protection and private vulnerability reporting enabled.
- **Current state:** the draft legal pages (`add-privacy-and-compliance` group 3) were written for a company, with
  four placeholders and a banner. `security.txt` and `SECURITY.md` list a mailbox that does not exist.
- **Tests that encode the draft:** a build check that allows placeholders only under the banner, a page test that
  requires the banner and placeholders, an E2E check for `.draft-banner`, and a container check for the banner text.

## Goals / Non-Goals

**Goals:** true, reachable contact details today; no placeholder that a visitor could mistake for a broken page; the
same honesty (testnet, unaudited, permanence, as-is).

**Non-Goals:** legal advice; inventing an entity; changing what data flows where.

## Decisions

### D1. GitHub is the only contact surface
- **Channels:**
  - privacy requests: a public issue from the new "Privacy request" form, or, for anything sensitive, a private
    security advisory (`/security/advisories/new`, now enabled);
  - security reports: private vulnerability reporting only.
- **No email, anywhere:**
  - `security.txt` keeps one `Contact` (the advisory URL; RFC 9116 accepts https URIs);
  - the CAA `iodef` suggestion in the deploy runbook is dropped (it needs a mailto or an IODEF endpoint);
  - inventory row 10 becomes GitHub correspondence.
- **Why not a mailbox:** none exists, an unmonitored one is worse than none, and GitHub already gives access control,
  2FA and an audit trail.
- **Trade-off:** a GitHub account is needed. Accepted, because the advisory form is the standard for open-source
  projects.

### D2. Controller and Grievance Officer framing
- **Controller and Data Fiduciary:** the maintainers, only for the correspondence they receive. The site holds no
  personal data (no logs, no storage).
- **Third-party data:** the services in the inventory (Fly, Pimlico, RPCs, Turbo/ar.io, Cloudflare, GitHub) are
  described as what the visitor's browser talks to, each under its own policy.
- **Grievance Officer:** "the project maintainer", reached via a private advisory, with the same 24 h / 15-day
  timelines. This states a role, not a person's name, and the role always exists.

### D3. Note instead of banner; no-placeholder guard
- **Note:** the banner is replaced by a `<p class="legal-note">` right after the effective date (rendered from the
  Markdown source so it is versioned with the text). The `mark.placeholder` style and the `PLACEHOLDERS`
  highlighting are removed.
- **Guard:** `verify-build` now fails if any shipped `.html` or `.txt` contains a bracketed ALL-CAPS placeholder
  (`/\[[A-Z][A-Z ]{2,}\]/`) or `@cryoshield.app`. This replaces the "banner while placeholders remain" check.
- **Regex limits:** the regex can't match normal text, which has no ALL-CAPS bracketed words. Markdown links are
  rendered to `<a>`, so `[text](url)` never reaches the HTML.

### D4. Terms mirror the MIT licence
- The Terms quote the licence's two operative sentences: the warranty disclaimer ("THE SOFTWARE IS PROVIDED "AS IS",
  WITHOUT WARRANTY OF ANY KIND…") and the liability exclusion ("IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
  LIABLE…").
- They extend both to the hosted site "to the extent the law allows", and keep a mandatory-consumer-law carve-out.
- The INR 1 cap and the "governing law: India, city of registered office" clause are dropped, because there is no
  registered office.

### D5. Supersedes (reconcile when `add-privacy-and-compliance` is archived)
- **`legal-pages`:**
  - "Draft status and placeholders" is superseded by `project-contact` "Not-legal-advice note" and "No placeholders
    or project mailboxes in shipped files";
  - "Privacy policy page" changes "controller/Data Fiduciary identity and address, a contact and Grievance Officer"
    to the OSS operator, GitHub contact and maintainer role;
  - "Security contact file" changes `Contact` to the advisory URL only.
- **`add-privacy-and-compliance` design:**
  - D6 placeholders are superseded;
  - D7's `mailto:` contact is removed;
  - inventory row 10 becomes GitHub.
- **Archive conflict:** these requirements are not in `openspec/specs/` yet, so this change ADDs `project-contact`.
  Whoever archives `add-privacy-and-compliance` must apply the modifications above to `legal-pages` in the same PR.

## Task notes for the compliance changes (archived files are not edited)

`add-privacy-and-compliance`:

| Task | New status |
|---|---|
| 1.1 entity, CIN, address, Grievance Officer | **N/A for the OSS project.** Operator and Grievance Officer per D2. Re-open only if a legal entity is formed. |
| 1.2 mailboxes (privacy@/security@/grievance@) | **N/A for the OSS project.** Replaced by GitHub channels (D1). |
| 1.3 Fly DPA, Pimlico DPA/retention | **Re-scoped:** the maintainer who holds the Fly/Pimlico accounts accepts Fly's DPA and asks Pimlico for retention, as account holder. Optional for the testnet. |
| 1.4 engage a lawyer | **N/A for the OSS project.** Community review via GitHub issues/PRs; revisit before mainnet if an entity forms. |
| 2.1 inventory, SR review | Still open (SR review against the built CSP). |
| 2.4 risk register + DPIA-lite, F sign-off | **Re-scoped:** maintainer sign-off instead of founder/entity. |
| 2.5 legal analysis with **[lawyer]** pack | **Re-scoped:** keep the analysis with the open questions marked; no lawyer pack. |
| 3.1 drafts, L light review | **Re-scoped:** done; "L review" becomes community review (the note on each page invites it). |
| 3.3 placeholder-under-banner check | **Superseded** by the no-placeholder guard (D3). |
| 3.6 SR claims check | Still applies. |
| 3.7 replace placeholders, remove banner | **Done by this change.** |
| 5.2 SECURITY.md + enable private reporting | **Done:** private reporting is enabled (founder); SECURITY.md updated here. |
| 6.2 incident runbook, F + SR sign | **Re-scoped:** maintainer + SR sign. CERT-In obligations attach to a body corporate; for an unincorporated OSS project, follow the runbook as best practice. |
| 6.3 erasure procedure | Still applies; replies go via GitHub. |
| 6.4 monthly audit-log export to an India-resident company drive | **Re-scoped:** a maintainer-held export (no company drive). |
| 7.1 lawyer opinions | **N/A for the OSS testnet.** Re-evaluate before mainnet, especially if an entity forms or sponsorship is paid in a regulated way. |
| 7.2 full DPIA (F + L) | **Re-scoped:** maintainer DPIA before mainnet. |
| 7.4 sanctions decision (F) | Maintainer decision before mainnet. |
| 7.7 DPDP readiness by May 2027 | Re-scoped to the maintainer; applies to the extent DPDP covers an unincorporated project. |
| 8.1–8.2 SOC 2 | **N/A for the OSS project** (SOC 2 attests an organisation). |

`add-privacy-preserving-analytics`:
- 3.1 (Cloudflare account + `VITE_CF_BEACON_TOKEN`) and 3.2 (self-hosting question) stay with the maintainer who holds
  the Cloudflare account.
- 6.3 is reassigned to the maintainer.

**PRD note for the overwatcher:** the open question "Legal entity details, Grievance Officer, and the mail provider"
is answered by D1/D2. Suggested PRD edit: "OSS project; contact via GitHub; Grievance Officer = project maintainer
(2026-10-03)".

## Risks / Trade-offs

- **[A GitHub account is required to make a privacy request]** → this is the norm for open-source projects. The form
  is short, and sensitive requests use the private advisory.
- **[Personal data posted in a public issue]** → the form's first element warns against it. Maintainers redact or
  delete such content, and the privacy page says so.
- **[No legal review]** → each page states plainly that it is not legal advice, keeps the conservative wording
  (testnet, unaudited, permanence), and invites corrections.

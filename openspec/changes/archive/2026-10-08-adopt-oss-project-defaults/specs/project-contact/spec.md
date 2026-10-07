# Spec Delta

## Purpose

Defines who operates CryoShield (an open-source project, not a company) and the only ways to reach it (GitHub), so
the legal pages, security contact files and templates are true, usable and free of placeholders.

## ADDED Requirements

### Requirement: Open-source operator identity
The privacy policy and the terms SHALL name the operator as "CryoShield, an open-source project maintained by its
contributors (github.com/prix0007/cryoshield)". They SHALL state that the maintainers act as controller and Data
Fiduciary only for the correspondence they receive, and that the site itself holds no personal data. They MUST NOT
name a company or a registered address.

#### Scenario: Operator stated
- **WHEN** the built `/privacy` and `/terms` pages are checked
- **THEN** each contains the operator sentence and a link to the repository, and neither contains "registered address" or a company name placeholder

### Requirement: GitHub-only contact channels
Privacy requests SHALL go to a GitHub issue opened from the "Privacy request" template, or to a GitHub private
security advisory for anything sensitive. Security reports SHALL go to GitHub private vulnerability reporting. No
shipped page, `SECURITY.md` or `security.txt` MAY list an email address.

#### Scenario: security.txt contact
- **WHEN** `/.well-known/security.txt` is served
- **THEN** its only `Contact` is `https://github.com/prix0007/cryoshield/security/advisories/new` and it contains no `mailto:`

#### Scenario: Privacy request template warns about secrets
- **WHEN** `.github/ISSUE_TEMPLATE/privacy-request.yml` is parsed
- **THEN** it is a valid issue form whose first element warns never to post secrets, seed phrases, recovery codes, keys or PINs, points sensitive requests to a private advisory, and requires the reporter to confirm they posted none

### Requirement: Grievance Officer
The privacy policy SHALL name the Grievance Officer as "the project maintainer", reachable through the private
advisory channel. It SHALL commit to acknowledging within 24 hours and resolving within 15 days, with escalation to
the Data Protection Board of India.

#### Scenario: Grievance section
- **WHEN** the built `/privacy` page is checked
- **THEN** its Grievance Officer section names the project maintainer, the advisory link, 24 hours and 15 days

### Requirement: Not-legal-advice note
Each legal page SHALL show, directly under its effective date, the note "Written for an open-source project; not
legal advice. Suggestions welcome via GitHub." It SHALL show no draft banner.

#### Scenario: Note instead of banner
- **WHEN** each built legal page is checked
- **THEN** the element after the effective date is the note, and the page contains no "Draft, pending legal review" banner and no placeholder highlight

### Requirement: No placeholders or project mailboxes in shipped files
The build verification MUST fail if any shipped HTML or text file contains a bracketed placeholder token (such as
`[ENTITY]`, `[REGISTERED ADDRESS]`, `[GRIEVANCE OFFICER]` or `[CONTACT EMAIL]`) or an `@cryoshield.app` address.

#### Scenario: Leftover placeholder
- **WHEN** a built page contains `[CONTACT EMAIL]` or `security@cryoshield.app`
- **THEN** `verify-build` fails, naming the file and the token

### Requirement: Honest open-source terms
The terms SHALL state that the software is provided "as is" under the MIT licence, mirroring the licence's warranty
disclaimer and limitation of liability. They SHALL keep the testnet, unaudited, no-recovery and permanence statements.

#### Scenario: Licence disclaimer mirrored
- **WHEN** the built `/terms` page is checked
- **THEN** it contains "WITHOUT WARRANTY OF ANY KIND" and "IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE", and the testnet, unaudited, all-keys-lost and permanence statements

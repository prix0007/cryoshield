# Proposal

## Why

On 2026-10-12, before the v1.0.0 release, the founder decided:
- CryoShield holds no personal information. There are no accounts, no cookies and no server logs of its own, and the
  only correspondence is on GitHub, which GitHub stores.
- `/privacy` should therefore not describe the maintainers as a data controller or Data Fiduciary.
- `/privacy` should drop the "Your rights" list and the "Grievance Officer" section.
- The US no-sale statement stays, because it ties to the analytics opt-out (Global Privacy Control).

## What Changes

- `/privacy`:
  - "Who we are" says CryoShield holds no personal data, and that GitHub stores messages sent through it. The
    controller and Data Fiduciary sentence is removed.
  - The "Your rights" section is replaced by "No sale or sharing", which keeps the US/CCPA/GPC statement only.
  - The "Grievance Officer" section is removed.
  - "Retention", "International transfers" and "Children" are reworded to match.
  - The effective date is now 2026-10-12, with a "Changes" entry.
- The contact links stay in "Who we are": the privacy-request issue template and private advisories.
- The privacy-request issue form and the triage bot's privacy reply match the policy. The form offers only
  deletion or redaction, a question, or other, and it promises no grievance timelines.
- Specs:
  - `project-contact`: the operator requirement no longer requires the controller and Data Fiduciary statement; the
    Grievance Officer requirement is removed;
  - `legal-pages`: the privacy requirement in the unarchived `add-privacy-and-compliance` change is edited in place.

## Impact

- Copy only: `apps/web/legal/privacy.md` and `test/legal/pages.test.ts`. No code, crypto, contract or CI change.
- `docs/compliance/` still describes the grievance process. Those internal records are left to the founder.

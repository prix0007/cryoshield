# Proposal

## Why

CryoShield is MIT-licensed open-source software with no company behind it. On 2026-10-12, before the v1.0.0 release,
the founder asked to remove two clauses from `/terms`, because the project does not take on that kind of liability:
- the donation "Tax" bullet (no tax receipts; the maintainer is responsible for tax due);
- the "Governing law" section (laws of India).

## What Changes

- `/terms`:
  - remove the "Tax" bullet from "Donations" and the whole "Governing law" section;
  - set the effective date to 2026-10-12, and log the change under "Changes".
- The MIT-based "Disclaimers" and "Limitation of liability" sections and the "Open-source software" section stay.
- Specs:
  - `donation`: "Donation terms and privacy" no longer requires a tax statement on `/terms`;
  - `legal-pages`: the "Terms of service page" requirement drops governing law. That requirement lives in the
    unarchived `add-privacy-and-compliance` change, so it is edited there.
- Unchanged:
  - `/support` and the README still say there are no tax receipts. That is a statement of fact, not a term.
  - `/privacy` keeps its GDPR and DPDP rights sections.

## Impact

- Copy only: `apps/web/legal/terms.md` and its two tests. No code, crypto, contract or CI change.

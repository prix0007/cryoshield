# Tasks

## 1. Guards and tests first

- [x] 1.1 Replace the "placeholders only under the banner" check with a no-placeholder guard: `checkNoPlaceholders(text, name)` fails on a bracketed ALL-CAPS token or `@cryoshield.app`. Write the failing unit tests first, then wire it into `verify-build` for every shipped `.html`/`.txt`. Verify with `pnpm exec vitest run test/build/legal-checks.test.ts` and `pnpm verify-build`.
- [x] 1.2 Update the build test `test/legal/pages.test.ts`:
  - the operator sentence and repository link on /privacy and /terms, with no "registered address";
  - the GitHub contact channels;
  - the Grievance Officer section (maintainer, advisory link, 24 h, 15 days);
  - the not-legal-advice note right after the effective date on every page, with no banner and no `mark.placeholder`;
  - the MIT disclaimer sentences in /terms.

  Update the security.txt unit test (advisory URL is the only Contact, no `mailto:`), E2E `08-legal` and the container test. Verify that they fail before the content change.

## 2. Content

- [x] 2.1 Rewrite the `apps/web/legal/{privacy,terms,cookies}.md` operator, contact, Grievance Officer, controller and terms sections (D2, D4). Add the note under each effective date, bump the effective date to 2026-10-03 with a changelog entry, remove the banner from the shells and the placeholder style. Verify that 1.2 passes.
- [x] 2.2 Update `security.txt` (GitHub advisory as the only Contact), `SECURITY.md` (GitHub only) and `apps/web/deploy/README.md` (drop the CAA iodef mailto). Update `docs/compliance/{data-inventory,subprocessors,retention}.md` to GitHub correspondence, and the earlier review records' open items. Verify with `git grep -n "@cryoshield.app"` (only archived OpenSpec files, the PRD and the active change design may still mention it).
- [x] 2.3 Add `.github/ISSUE_TEMPLATE/privacy-request.yml` (an issue form with a first-element warning against posting secrets, keys, recovery codes or PINs, a pointer to private advisories for sensitive requests, and a required confirmation checkbox). Verify with a unit test that parses the YAML and checks the warning and the confirmation.

## 3. Verification

- [x] 3.1 Regenerate `apps/web/docs/screenshots/legal-{privacy,terms,cookies}.png`. Run every web suite (unit, lint, typecheck, verify-build, int, E2E, deploy/container) and `openspec validate --all --strict`.

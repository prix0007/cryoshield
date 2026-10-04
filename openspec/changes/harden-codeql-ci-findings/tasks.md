# Tasks

## 1. Triage comment escaping (CodeQL #3, tests first)

- [x] 1.1 Write the regression test first in `test/triage-review.test.mjs`. It covers `<<!!-- x --<!>`, a forged run marker inside split delimiters, `--!>`, tags, and inert display. Then replace the strip in `composeComment` with escaping plus marker-name breaking. Verify with `npm test --prefix .github/scripts`.

## 2. Review workspace layout (CodeQL #1, tests first)

- [x] 2.1 Write the policy tests first in `test/privileged-workflows.test.mjs`:
  - base at the root, head only in `pr/`;
  - a root or other-path head checkout is refused;
  - a base checkout with a path is refused;
  - `pr/.git` is denied;
  - the restore runs in `pr/`;
  - the prompt points at `./pr/`.

  Then change `ecc-review.yml` and `workflow-policy.mjs`, and re-pin the reviewed digests. Verify that the policy is OK, actionlint and zizmor are clean, and the restore behaves correctly in a simulation on a throwaway repository.

## 3. Integration

- [x] 3.1 Run `npm test`, the policy check, actionlint, zizmor, `openspec validate --all --strict` and gitleaks on the range. CodeQL can't run locally (no CLI), so the PR's CodeQL check must pass.

## 4. Security review

- [ ] 4.1 The security reviewer reviews this change, covering:
  - escaping completeness (no comment or marker survives, mentions are still neutralised);
  - the ECC workspace: nothing PR-controlled is at the root, the restore is correct for the new layout, and the credential assertion covers both checkouts;
  - the policy enforcement.

  Verify by recording an APPROVE, or the findings plus fixes, in `design.md`.

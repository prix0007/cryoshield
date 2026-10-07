# Tasks

## 1. Pins and workflows

- [x] 1.1 Verify the pins: resolve the tags to commits, and check that each is an ancestor of the default branch and that the inputs/agents exist.
  - `claude-code-action` v1.0.240 resolves to `ed670b4c…`;
  - ECC v2.2.3 resolves to `c05b2d66…`;
  - `actions/checkout` v7.0.1 resolves to `3d3c42e5…`.

  Verify that the results are recorded in design decision 4.
- [x] 1.2 Add `.github/workflows/ecc-review.yml` with every safeguard of decision 2, the CryoShield reviewer matrix, and `REVIEW_MODEL`. Verify that actionlint is clean.
- [x] 1.3 Add `.github/workflows/auto-merge.yml` (decision 5). Verify that actionlint is clean.

## 2. Workflow policy (tests first)

- [x] 2.1 Write `test/privileged-workflows.test.mjs` first: each case mutates the real files and must fail. The cases cover:
  - another file using `pull_request_target` or `issue_comment`;
  - extra triggers;
  - a fork guard removed, or moved after another step;
  - a checkout in `auto-merge`;
  - a head checkout without the SHA, or without `persist-credentials: false`;
  - a run step that executes files;
  - local or non-allow-listed actions;
  - extra write scopes;
  - top-level permissions;
  - owner-only and no-actions for comments;
  - secret placement;
  - narrow zizmor ignores.

  Verify that the tests are red before the implementation.
- [x] 2.2 Implement the `PRIVILEGED` profile in `workflow-policy.mjs`, plus the zizmor ignore rule (decision 3) and `.github/zizmor.yml`. Verify:
  - `npm test --prefix .github/scripts` is green;
  - `node .github/scripts/workflow-policy.mjs .github` is OK;
  - zizmor in the pedantic persona has 0 findings (2 ignored).

## 3. Ruleset tooling (tests first)

- [x] 3.1 Write tests first for:
  - the `hold` label;
  - `allow_auto_merge`;
  - `--with-ecc-review` (adds the check, is idempotent, and refuses to drop a live requirement without the flag);
  - `ecc-review-check.json`.

  Then implement them in `apply.sh` and `repo-settings.json`. Verify that the tests are green, shellcheck is clean, and a read-only dry run against the live repo works under macOS `/bin/bash` 3.2.

## 4. Docs and template (tests first)

- [x] 4.1 Extend `test/pr-template.test.mjs`: the Tasks covered, Verification and Review sections, the review/merge words, and `AGENTS.md` → `CLAUDE.md` with the change flow and the `<!-- claude-pr-flow -->` marker. Then update `.github/pull_request_template.md` and add `CLAUDE.md` and `AGENTS.md`. Verify that the tests are green and the `No-spec justification:` test still passes.
- [x] 4.2 Update the README "Contributing / PR workflow": ECC review, auto-merge, `hold`, the secret, and `apply.sh --with-ecc-review --apply`. Verify that the section names the exact secret and the command.

## 5. Integration

- [x] 5.1 Run the full local suite and verify that all are green:
  - `npm test --prefix .github/scripts`;
  - actionlint;
  - zizmor pedantic;
  - the workflow policy;
  - shellcheck;
  - `openspec validate --all --strict`;
  - `scripts/check-licenses.sh`;
  - the OpenSpec gate and title check on this branch's range.

## 6. Security review

- [x] 6.1 The security reviewer reviews this change, covering:
  - the `pull_request_target`/`issue_comment` exposure;
  - fork handling;
  - whether any path executes PR code (including the action's own startup and the restored config);
  - agent tool limits and credential scrubbing;
  - the review-posting guard;
  - the dismissal logic;
  - the `rerun` authorization;
  - the auto-merge conditions and the `hold` veto;
  - the robustness of the policy exception;
  - pin provenance.

  Verify by recording an APPROVE, or the findings plus fixes, in design.md.

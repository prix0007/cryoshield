# Tasks

## 1. Supersede logic (tests first)

- [x] 1.1 Write `test/supersede.test.mjs` first, using a stub `gh` with runs fixtures. It must show that the script:
  - cancels an older waiting run for another commit with a pending `production` deployment;
  - never cancels a run that is deploying (`in_progress`), its own run, a run for the same commit, a newer run, or a run with no pending deployment (re-checked at cancel time);
  - fails on API errors.

  Then implement `.github/scripts/deploy/supersede.sh`. Verify with `npm test --prefix .github/scripts`.

## 2. Workflow and policy (tests first)

- [x] 2.1 Rewrite the tests in `test/deploy-workflow.test.mjs` (and add `test/gate-deploy.test.mjs`) first, covering:
  - exactly one `production` job, the token only there;
  - `production-build` without the token;
  - job-level `deploy-production` concurrency that is never cancelled;
  - per-commit workflow concurrency;
  - `supersede` the only job with `actions: write`;
  - smoke and rollback in the release job, with rollback on `failure()` or `cancelled()`.

  Then restructure `deploy.yml` (decisions 1–3) and extend `workflow-policy.mjs` (decision 4). Verify that `npm test` is green, the policy is OK, actionlint and zizmor pedantic are clean, and the release-job digests are re-pinned.

## 3. apply.sh (tests first)

- [x] 3.1 Extend the stub and add `test/apply-sh-environments.test.mjs` first:
  - `--environments` dry run shows drift;
  - `--apply` PUTs `production` with the owner id, `can_admins_bypass: false` and `prevent_self_review: false`;
  - the branch policies are reconciled to `main`;
  - `production-build` is created;
  - running again is idempotent;
  - `--founder-hardening` is off by default, and on demand enables security updates, vulnerability alerts and `sha_pinning_required`.

  Then implement them. Verify with `npm test` and shellcheck, plus a read-only live dry run.

## 4. Docs

- [ ] 4.1 Write `docs/agent-account.md` and update:
  - CLAUDE.md "Change flow" (the machine account; releases wait for owner approval);
  - `docs/deploy.md` (approve in the UI and with `gh api`; the `production-build` setup; superseding);
  - the README;
  - `docs/system-design.md`.

  Verify that the commands are correct (`gh api` paths checked).

## 5. Integration

- [ ] 5.1 Run the full suite and verify that all are green: `npm test`, actionlint, zizmor, the policy, shellcheck, `openspec validate --all --strict`, the licence check, and gitleaks on the range.

## 6. Security review

- [ ] 6.1 The security reviewer reviews this change, covering:
  - whether the approval gate can be bypassed (other jobs, environments or workflows);
  - the one-click property;
  - the supersede safety (it never cancels mid-deploy, and abuse);
  - token isolation;
  - the `apply.sh` environment configuration;
  - the agent-account permissions.

  Verify by recording an APPROVE, or the findings plus fixes, in design.md.

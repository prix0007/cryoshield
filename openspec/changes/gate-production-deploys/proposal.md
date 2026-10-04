# Proposal

## Why

The October 2026 audit (`docs/reviews/security-audit-2026-10.md`) found two problems:
- **CI-C1 (critical):** any same-repo PR can reach production with no human in the loop. The gates are an LLM verdict and a `ci-ok` that the PR itself produces, and continuous deploy follows.
- **CI-H1 (high):** agents act with the sole admin's token, so rulesets don't bind them.

The founder chose option A: merges stay automatic, but **production deploys need the founder's one-click approval**, and agents move to a separate non-admin account.

## What Changes

- **`deploy.yml`:** only one job uses environment `production`: `release`, which runs deploy, smoke test and automatic rollback.
  - `production` gets the owner as required reviewer, with `can_admins_bypass: false`. Each release then needs exactly one click, and rollback after a failed smoke test needs no second approval.
  - The build job moves to a new environment, `production-build` (no reviewers, `main` only), which holds the `VITE_*` variables and the bundler-URL secret. It never sees the Fly token.
- **Waiting approvals don't pile up:**
  - The workflow concurrency group is per commit (`deploy-<sha>`), so the 15-minute schedule leaves at most one run per commit waiting.
  - `release` has job-level concurrency `deploy-production` that is never cancelled.
  - A new `supersede` job cancels **older runs still waiting for approval** once a newer commit has passed CI and built. It never touches a run that is deploying; a rollback on cancellation covers the remaining race.
- **Workflow policy:**
  - `FLY_API_TOKEN` appears only in jobs with environment `production`, and every `production` job holds it. At most one job uses `production`, and `production-build` never sees the token.
  - Only `supersede` may have `actions: write`.
- **`apply.sh`:**
  - `--environments` idempotently configures `production` (required reviewer = owner id from `gh api users/<owner>`, `can_admins_bypass: false`, `prevent_self_review: false`, `main`-only branch policy) and `production-build` (`main`-only branch policy).
  - `--founder-hardening` (off by default) enables Dependabot security updates, vulnerability alerts and the Actions `sha_pinning_required` setting.
- **Docs:**
  - new `docs/agent-account.md`: a machine user with Write access and a fine-grained PAT;
  - CLAUDE.md: agents act as the machine account, and production waits for owner approval;
  - `docs/deploy.md`: how to approve, in the UI and with `gh api`;
  - the README;
  - `docs/system-design.md`.
- **Runtime dependencies: none.** This is CI and repository configuration only.

**Out of scope:**
- creating the machine user or PAT (founder);
- code-owner review for sensitive paths;
- CI-H2 (App-posted status).

## Capabilities

### New Capabilities
<!-- none: continuous-deployment is introduced by add-continuous-deploy (archived first) -->

### Modified Capabilities
- `continuous-deployment`: adds owner approval for production releases, one approval per release, and superseding of waiting releases.
- `contribution-workflow`: agents act through a non-admin machine account.
- `ci-pipeline`: the deploy-environment policy rules.

## Impact

- **Edited:**
  - `.github/workflows/deploy.yml`;
  - `.github/scripts/workflow-policy.mjs` and its tests;
  - `.github/scripts/privileged-run-steps.json` (release job digests);
  - `.github/rulesets/apply.sh` and its tests;
  - CLAUDE.md, README, `docs/deploy.md`, `docs/system-design.md`.
- **New:**
  - `.github/scripts/deploy/supersede.sh` and its tests;
  - `docs/agent-account.md`.
- **After merge (overwatcher):** the founder moves the build variables to `production-build`, then runs `apply.sh --environments --apply`. Until then the build job lacks its variables and fails closed, and nothing is deployed.

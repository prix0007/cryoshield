# Spec Delta

## REMOVED Requirements

### Requirement: Deployment workflow restrictions
**Reason**: There are now two deploy workflows, with different triggers.
**Migration**: See "Deploy workflow restrictions per target".

### Requirement: Deploy environment policy
**Reason**: The rule now covers four environments in two workflows, and the `supersede` `actions: write` exception is removed.
**Migration**: See "Deploy workflow restrictions per target".

## MODIFIED Requirements

### Requirement: Unconfigured deploys skip without failing
Before the full CI, each deploy workflow SHALL check, in its build environment, that every required build variable and the `VITE_BUNDLER_URL` secret are non-empty: `deploy-dev.yml` checks `development-build`, and `deploy.yml` checks `production-build`. The check SHALL use presence flags only (`${{ vars.X != '' }}`, `${{ secrets.X != '' }}`), never the values.

If anything is missing:
- `deploy-dev.yml` (polled on every `main` commit) SHALL emit a `deploy not configured` warning that names the missing items and the environment and points to `docs/deploy.md`, in the log and the job summary. It SHALL skip every later job (CI, build, release) and conclude successfully, so `main` is never marked red.
- `deploy.yml` (an owner's release, or a dispatch at a release tag, always deliberate) SHALL emit the same message as an error, skip every later job, and **fail**.

Fully configured runs SHALL behave as before. The workflow policy SHALL allow a secret presence expression only for `VITE_BUNDLER_URL`, in the `config` step of a job in the workflow's own build environment.

#### Scenario: Dev not configured
- **WHEN** `deploy-dev.yml` runs and `development-build` has no variables or secrets
- **THEN** the run logs a warning naming every missing item and `development-build`, builds and deploys nothing, and concludes success

#### Scenario: Production partly configured
- **WHEN** the owner publishes a release and only `VITE_BUNDLER_URL` is missing from `production-build`
- **THEN** the run reports an error naming `VITE_BUNDLER_URL`, builds and deploys nothing, and fails

#### Scenario: Configured later
- **WHEN** the configuration is completed after skipped dev runs
- **THEN** the next merge or a forced `workflow_dispatch` of `deploy-dev.yml` deploys normally, because skipped runs do not count as failed

#### Scenario: Fly token missing
- **WHEN** a release job runs with an empty `FLY_API_TOKEN` in its environment (`development` or `production`)
- **THEN** it fails at once with a `deploy not configured` error that names `FLY_API_TOKEN` and that environment, before calling flyctl

## ADDED Requirements

### Requirement: Deploy workflow restrictions per target
The workflow policy SHALL enforce, for each deploy workflow:

- **`deploy-dev.yml` (development):**
  - triggers only on `push` to `main`, `schedule` and `workflow_dispatch`;
  - its first job requires `github.ref == 'refs/heads/main'`;
  - it uses only environments `development` and `development-build`.
- **`deploy.yml` (production):**
  - triggers only on `release` with `types: [published]` and `workflow_dispatch` without inputs (the release tag is the run's own ref);
  - its first job requires `github.triggering_actor == github.repository_owner` and `startsWith(github.ref, 'refs/tags/v')`, for both events;
  - it has no workflow-level concurrency group (that group would be claimed before the owner gate);
  - it uses only environments `production` and `production-build`;
  - its release job re-checks the tag (`release-ref.sh`) before deploying.
- **Both:**
  - no `pull_request` or `pull_request_target` trigger;
  - a never-cancelled job-level release group (`deploy-development` or `deploy-production`); `deploy-dev.yml` also has an exact, never-cancelled per-commit workflow group;
  - exactly one job in the release environment, holding `FLY_API_TOKEN` only in the step env of steps `deploy` and `rollback`;
  - the bundler URL only in its build environment;
  - no write scopes;
  - no `always()`, `failure()` or `cancelled()`, in any letter case, in a job-level condition (they are allowed only in the step conditions of the rollback and fail-loudly steps);
  - every job that needs `config` requires `needs.config.outputs.configured == 'true'`;
  - the release job's re-check step runs immediately before the `deploy` step;
  - `deploy-dev.yml` never references `VITE_CF_BEACON_TOKEN`;
  - no `secrets: inherit`;
  - every run step of a token-holding job pinned by digest;
  - no build tooling in the release job.

No other workflow may reference `FLY_API_TOKEN` or use any of the four deploy environments; in particular only `deploy.yml` may use `production` or `production-build`.

#### Scenario: Production workflow on push
- **WHEN** `deploy.yml` gains a `push` or `schedule` trigger
- **THEN** the workflow policy check fails

#### Scenario: Cross-target environment
- **WHEN** a job in `deploy-dev.yml` uses environment `production`
- **THEN** the workflow policy check fails

#### Scenario: Release after a failed build
- **WHEN** a deploy workflow's release job condition becomes `always() && needs.detect.outputs.deploy == 'true'`
- **THEN** the workflow policy check fails

#### Scenario: Production from a branch
- **WHEN** `deploy.yml`'s first job accepts a dispatch from `refs/heads/main`, or the dispatch gains a `tag` input
- **THEN** the workflow policy check fails

#### Scenario: Owner gate removed
- **WHEN** the first job of `deploy.yml` drops the `github.triggering_actor == github.repository_owner` conjunct
- **THEN** the workflow policy check fails

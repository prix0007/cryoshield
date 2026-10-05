# Spec Delta

## REMOVED Requirements

### Requirement: Deployment workflow restrictions
**Reason**: There are now two deploy workflows, with different triggers.
**Migration**: See "Deploy workflow restrictions per target".

### Requirement: Deploy environment policy
**Reason**: The rule now covers four environments in two workflows, and the `supersede` `actions: write` exception is removed.
**Migration**: See "Deploy workflow restrictions per target".

### Requirement: Reusable full CI run
**Reason**: The reusable CI must also test a given commit (the tagged one) when it is called from a dispatch on `main`.
**Migration**: See "Reusable full CI run on a given commit".

## ADDED Requirements

### Requirement: Reusable full CI run on a given commit
The CI workflow SHALL be callable by other workflows. When called with `full: true`, it MUST run every area job regardless of path filters, and it MUST report failure if any job fails. When called with a `ref`, every area job MUST check out that commit; without one, the caller's commit is used. A called run MUST NOT share a concurrency group with push or pull-request CI runs.

#### Scenario: Rollback dispatch tests the tag
- **WHEN** the production workflow is dispatched from `main` for tag `v1.1.0` and calls CI with `ref` set to that tag's commit
- **THEN** every area job checks out and tests that commit, not `main`'s HEAD

### Requirement: Deploy workflow restrictions per target
The workflow policy SHALL enforce, for each deploy workflow:

- **`deploy-dev.yml` (development):**
  - triggers only on `push` to `main`, `schedule` and `workflow_dispatch`;
  - its first job requires `github.ref == 'refs/heads/main'`;
  - it uses only environments `development` and `development-build`.
- **`deploy.yml` (production):**
  - triggers only on `release` with `types: [published]` and `workflow_dispatch`;
  - its first job requires `github.triggering_actor == github.repository_owner`, and the release-or-dispatch-from-`main` ref condition;
  - it uses only environments `production` and `production-build`;
  - its release job re-checks the tag (`release-ref.sh`) before deploying.
- **Both:**
  - no `pull_request` or `pull_request_target` trigger;
  - an exact, never-cancelled workflow concurrency group, and a separate job-level release group (`deploy-development` or `deploy-production`);
  - exactly one job in the release environment, holding `FLY_API_TOKEN` only in the step env of steps `deploy` and `rollback`;
  - the bundler URL only in its build environment;
  - no write scopes;
  - no `secrets: inherit`;
  - every run step of a token-holding job pinned by digest;
  - no build tooling in the release job.

No other workflow may reference `FLY_API_TOKEN` or use any of the four deploy environments.

#### Scenario: Production workflow on push
- **WHEN** `deploy.yml` gains a `push` or `schedule` trigger
- **THEN** the workflow policy check fails

#### Scenario: Cross-target environment
- **WHEN** a job in `deploy-dev.yml` uses environment `production`
- **THEN** the workflow policy check fails

#### Scenario: Owner gate removed
- **WHEN** the first job of `deploy.yml` drops the `github.triggering_actor == github.repository_owner` conjunct
- **THEN** the workflow policy check fails

# Spec Delta

## Purpose

Deploy every tested commit on `main` to production automatically. Detect which commit is live, verify the deployment, and roll back automatically when it fails.

## ADDED Requirements

### Requirement: Deploy main after full CI
Every new commit on `main` SHALL be deployed to production within about 15 minutes, whether it was merged by a person or by auto-merge. The full CI MUST first pass on that exact commit, with no path filters. A deployment MUST NOT start from a pull request, from a ref other than `main`, or while another deployment is in progress. An in-progress deployment MUST NOT be cancelled.

#### Scenario: Human merge
- **WHEN** a pull request is merged into `main` by a person
- **THEN** the push starts the pipeline, which runs the full CI on the merge commit and then deploys it

#### Scenario: Auto-merge
- **WHEN** a pull request is merged by GitHub auto-merge, so no push workflow starts
- **THEN** the scheduled run within 15 minutes detects that the live commit differs from `main` and deploys

#### Scenario: CI fails on main
- **WHEN** any CI job fails on the `main` HEAD
- **THEN** nothing is deployed and the run fails

#### Scenario: Nothing new
- **WHEN** `/release.json` already reports the `main` HEAD commit
- **THEN** the run skips CI and deployment

### Requirement: Production credentials isolation
The deploy credential (`FLY_API_TOKEN`, a deploy token scoped to the `cryoshield-web` app) SHALL exist only in the GitHub Environment `production`, restricted to the `main` branch. It SHALL be referenced only by the deploy and rollback steps. Build configuration SHALL come from environment variables, with the bundler URL as a masked environment secret, and SHALL never be committed.

#### Scenario: Token referenced elsewhere
- **WHEN** a workflow references `FLY_API_TOKEN` outside the deploy or rollback step of `deploy.yml`
- **THEN** the workflow policy check fails

### Requirement: Smoke test and automatic rollback
After every deployment, the pipeline SHALL verify the live site:
- `/`, `/app/`, `/architecture`, `/privacy` and `/healthz` return 200;
- the security headers are present;
- `/architecture` shows the registry address from `contracts/deployments/<chainId>.json`;
- `/release.json` reports the deployed commit.

On any failure it MUST redeploy the previously live image, and then fail the run.

#### Scenario: Broken release
- **WHEN** the new release serves `/app/` with a 500
- **THEN** the pipeline redeploys the image that was live before, and the run fails with the smoke-test error

#### Scenario: No previous image
- **WHEN** a smoke test fails and no previous image was recorded
- **THEN** the run fails loudly and states that no automatic rollback was possible

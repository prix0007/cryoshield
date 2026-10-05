# Spec Delta

## REMOVED Requirements

### Requirement: Owner approval for production releases
**Reason**: The founder removed the manual release approval on 2026-10-05; releases deploy automatically after CI and the build pass on `main`.
**Migration**: The `production` environment keeps its `main`-only branch policy and the Fly token, with no required reviewer. Re-add the reviewer in `.github/rulesets/environments.json` before the mainnet launch.

## ADDED Requirements

### Requirement: Automatic production releases
Every commit on `main` that passes the full CI and the guarded build SHALL be released to production without a manual approval. Exactly one job per release SHALL use the Environment `production`, and that job SHALL deploy, smoke-test and, on failure or cancellation after deploying, roll back. The `production` environment SHALL remain deployable from `main` only.

#### Scenario: Merge goes live
- **WHEN** a pull request auto-merges and CI and the build pass on `main`
- **THEN** the release job deploys that commit without waiting for anyone

#### Scenario: Failed smoke test
- **WHEN** a release fails its smoke test
- **THEN** it rolls back to the previous image within the same job and the run fails

#### Scenario: Deploy from another branch
- **WHEN** a workflow on a branch other than `main` requests the `production` environment
- **THEN** GitHub refuses it because of the branch policy

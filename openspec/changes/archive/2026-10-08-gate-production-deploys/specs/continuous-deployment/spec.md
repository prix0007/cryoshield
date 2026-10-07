# Spec Delta

## Purpose

Deploy every tested commit on `main` to production, with the owner's approval, and roll back automatically when the release fails.

## ADDED Requirements

### Requirement: Owner approval for production releases
Every production release SHALL wait for an approval by the repository owner. The approval is enforced by a required reviewer on the GitHub Environment `production`, which administrators cannot bypass. Exactly one job per release SHALL use `production`, and that job SHALL deploy, smoke-test and, on failure or cancellation after deploying, roll back without a further approval.

#### Scenario: Merge without approval
- **WHEN** a pull request auto-merges and CI and the build pass on `main`
- **THEN** the release waits for the owner's approval, and nothing is deployed until it is given

#### Scenario: Failed smoke test after approval
- **WHEN** an approved release fails its smoke test
- **THEN** it rolls back to the previous image within the same approved job, with no second approval

### Requirement: Waiting releases do not pile up
While a release waits for approval, scheduled runs for the same commit SHALL NOT start another release. When a newer commit has passed CI and built, older releases still **waiting** for approval SHALL be cancelled. A release that is already deploying MUST NOT be cancelled by this mechanism.

#### Scenario: Main moves while a release waits
- **WHEN** commit A's release is waiting for approval and commit B then passes CI and builds
- **THEN** A's waiting run is cancelled and only B's release waits for approval

#### Scenario: Same commit on the schedule
- **WHEN** commit A's release is waiting for approval and the 15-minute schedule fires
- **THEN** at most one further run for A is queued, and it starts no CI or release while A waits

### Requirement: Build configuration isolated from the deploy token
Build configuration (the `VITE_*` variables and the bundler URL) SHALL live in a separate environment, `production-build`, restricted to `main`. The Fly token SHALL exist only in `production` and be referenced only by the release job.

#### Scenario: Token outside the release job
- **WHEN** a job other than the `production` release job references `FLY_API_TOKEN`
- **THEN** the workflow policy check fails

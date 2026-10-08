# Spec Delta

## MODIFIED Requirements

### Requirement: Only the owner can trigger production
Creating, updating and deleting **any** tag (`~ALL`, which includes every `refs/tags/v*`) SHALL be restricted by a tag ruleset, kept as code and synced by `.github/rulesets/apply.sh`, whose only bypass actor is the repository admin role. Protecting every tag, not only a `v*` pattern, makes the boundary independent of how GitHub matches the ruleset and environment patterns. The production workflow SHALL run only when the triggering actor is the repository owner. The `production` and `production-build` environments SHALL be deployable ONLY from `v*` tags, with no branch policy at all (not even `main`), so the only path to production secrets is a tag that only an admin can create.

#### Scenario: Agent creates a release tag
- **WHEN** the agents' machine account (Write role) tries to push tag `v9.9.9`, or to create a release that would create it
- **THEN** GitHub rejects it because of the tag ruleset

#### Scenario: Agent creates any other tag
- **WHEN** a non-admin account pushes `refs/tags/probe-1` or `refs/tags/V0.0.1-probe`
- **THEN** GitHub rejects it because of the tag ruleset, so no tag the production environments might accept can exist without an admin

#### Scenario: Agent publishes or dispatches
- **WHEN** a non-owner publishes a release on an existing tag, dispatches the production workflow, or re-runs a production run
- **THEN** the production workflow's first job is skipped, and nothing is deployed

### Requirement: Smoke test and automatic rollback per target
After every deployment, the pipeline SHALL verify the target's live site:
- `/`, `/app/`, `/architecture`, `/devices`, `/support`, `/privacy` and `/healthz` return 200;
- the security headers are present;
- `/` sends a Permissions-Policy with `publickey-credentials-get=()` and `publickey-credentials-create=()`, and `/app/` one with `publickey-credentials-get=(self)` and `publickey-credentials-create=(self)`;
- `/architecture` shows the registry address from `contracts/deployments/<chainId>.json`;
- `/support` shows the configured donation address only;
- `/release.json` reports the deployed commit, and its `treeHash` equals the tree hash the build job published as a job output.

On development, every page MUST carry `X-Robots-Tag: noindex, nofollow`. On production, no page may carry a noindex header. On any failure, the pipeline MUST redeploy the target's previously live image and then fail the run.

#### Scenario: Dev Caddyfile on production
- **WHEN** a production release serves `X-Robots-Tag: noindex`
- **THEN** the smoke test fails, the previous production image is redeployed, and the run fails

#### Scenario: Landing page gains WebAuthn
- **WHEN** a release serves `/` with `publickey-credentials-get=(self)`, or `/app/` with `publickey-credentials-get=()`
- **THEN** the smoke test fails, the previous image is redeployed, and the run fails

#### Scenario: Live tree differs from the build
- **WHEN** the live `/release.json` `treeHash` differs from the build job's `tree_hash` output
- **THEN** the smoke test fails, the previous image is redeployed, and the run fails

## ADDED Requirements

### Requirement: Build-to-release hand-off verified across jobs
The build job SHALL publish the deploy context's site tree hash and Caddyfile hash as job outputs, computed from the built files and checked against the release manifest. The release job SHALL recompute both from the downloaded artifact and refuse to deploy unless they equal the build job's outputs, in addition to the manifest. A missing, empty or malformed expected hash SHALL fail the release job; it MUST NOT skip the comparison.

#### Scenario: Artifact altered after the build
- **WHEN** the downloaded deploy context has a site file or Caddyfile that differs from what the build job hashed, even with a consistent manifest
- **THEN** the release job fails before the re-check and `fly deploy`, and nothing is deployed

#### Scenario: Build output missing
- **WHEN** the release job runs with an empty `needs.build.outputs.tree_hash`
- **THEN** the verify step exits with a usage error and nothing is deployed

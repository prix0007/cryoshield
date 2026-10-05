# Spec Delta

## REMOVED Requirements

### Requirement: Deploy main after full CI
**Reason**: `main` now deploys to the development site, not to production (founder request, 2026-10-05).
**Migration**: See "Deploy main to development after full CI" and "Production releases from published tags".

### Requirement: Automatic production releases
**Reason**: Production now deploys only from a release published by the owner.
**Migration**: See "Production releases from published tags".

### Requirement: Waiting releases do not pile up
**Reason**: No deploy waits for an approval any more. The `supersede` job is removed, and concurrency replaces pending releases natively.
**Migration**: See "Development releases follow main".

### Requirement: Production credentials isolation
**Reason**: There are now two Fly tokens, one per target.
**Migration**: See "Per-target credentials isolation".

### Requirement: Build configuration isolated from the deploy token
**Reason**: Superseded by the per-target rule, which covers `development-build` too.
**Migration**: See "Per-target credentials isolation".

### Requirement: Smoke test and automatic rollback
**Reason**: The smoke test is now per target, and checks the noindex header.
**Migration**: See "Smoke test and automatic rollback per target".

## ADDED Requirements

### Requirement: Deploy main to development after full CI
Every new commit on `main` SHALL be deployed to the development site within about 15 minutes, whether a person or auto-merge merged it. The development site is `https://dev.cryoshield.app` (Fly app `cryoshield-web-dev`) on OP Sepolia. The full CI MUST first pass on that exact commit. The deployment SHALL need no approval, and MUST NOT start from a pull request or from a ref other than `main`. It SHALL use the GitHub Environments `development-build` (build config) and `development` (Fly token only), both deployable from `main` only.

#### Scenario: Auto-merge reaches dev
- **WHEN** a pull request is merged by GitHub auto-merge
- **THEN** within 15 minutes the scheduled run tests the merge commit and deploys it to `https://dev.cryoshield.app`, and production is unchanged

#### Scenario: Nothing new
- **WHEN** `https://dev.cryoshield.app/release.json` already reports `main`'s HEAD commit
- **THEN** the run skips CI and deployment

### Requirement: Development releases follow main
A development release SHALL refuse to deploy a commit that is no longer `main`'s HEAD, both when the run starts and right before `fly deploy`. Development and production SHALL use separate concurrency groups, so neither ever cancels or queues behind the other.

#### Scenario: Main moves during a dev run
- **WHEN** commit A's dev release is about to deploy and `main` has moved on to B
- **THEN** A's release fails without deploying, and B's run deploys B

### Requirement: Development site isolation
The development build SHALL use the WebAuthn RP ID `dev.cryoshield.app`, and MUST NOT use `cryoshield.app`. The deploy script MUST refuse a development build whose configured RP ID differs from `dev.cryoshield.app`, or whose bundle carries another RP ID. Every response from the development host SHALL carry `X-Robots-Tag: noindex, nofollow`; this header is the only indexing control, and the development deploy MUST NOT add a `robots.txt` of its own (a static one would also ship to production). The strict CSP and the other security headers stay unchanged. The development build SHALL carry no analytics beacon.

#### Scenario: Production RP ID on dev
- **WHEN** `development-build` sets `VITE_RP_ID=cryoshield.app`
- **THEN** `deploy.sh` refuses the build, and nothing is deployed

#### Scenario: Dev is crawled
- **WHEN** a crawler fetches any page of `https://dev.cryoshield.app`
- **THEN** the response carries `X-Robots-Tag: noindex, nofollow`

### Requirement: Production releases from published tags
Production (`https://cryoshield.app`, Fly app `cryoshield-web`) SHALL be deployed only in two cases:
- a GitHub Release is published for a tag matching `v<major>.<minor>.<patch>[-<pre>]`;
- the repository owner dispatches the production workflow from `main` with such a tag, to redeploy or roll back.

The tagged commit MUST be reachable from `main`'s HEAD, or the run MUST fail before any build. The full CI MUST pass on the tagged commit, the build MUST use `production-build`, and the release MUST run in `production`. Right before deploying, the release MUST re-check that the tag still points at the built commit and that the commit is still reachable from `main`. Production SHALL use the chain configured in `production-build`, and no chain SHALL be hardcoded in the workflow. Releases SHALL NOT be polled.

#### Scenario: Owner publishes a release
- **WHEN** the owner runs `gh release create v1.2.0 --target main --generate-notes`
- **THEN** the production workflow runs the full CI on the tagged commit, builds it and deploys it to `https://cryoshield.app`

#### Scenario: Tag not on main
- **WHEN** a release is published for a tag whose commit is not an ancestor of `main`'s HEAD
- **THEN** the run fails in its first job, and nothing is built or deployed

#### Scenario: Rollback to an earlier release
- **WHEN** the owner runs `gh workflow run deploy.yml -f tag=v1.1.0`
- **THEN** the production workflow tests, builds and deploys the commit of `v1.1.0`

#### Scenario: Merge to main
- **WHEN** a pull request is merged into `main`
- **THEN** the production workflow does not run

### Requirement: Only the owner can trigger production
Creating, updating and deleting tags `refs/tags/v*` SHALL be restricted by a tag ruleset, kept as code and synced by `.github/rulesets/apply.sh`, whose only bypass actor is the repository admin role. The production workflow SHALL run only when the triggering actor is the repository owner. The `production` and `production-build` environments SHALL be deployable only from `main` and from `v*` tags.

#### Scenario: Agent creates a release tag
- **WHEN** the agents' machine account (Write role) tries to push tag `v9.9.9`, or to create a release that would create it
- **THEN** GitHub rejects it because of the tag ruleset

#### Scenario: Agent publishes or dispatches
- **WHEN** a non-owner publishes a release on an existing tag, dispatches the production workflow, or re-runs a production run
- **THEN** the production workflow's first job is skipped, and nothing is deployed

### Requirement: Per-target credentials isolation
Each target's Fly deploy token, scoped to its own app, SHALL exist only in that target's release environment: `production` for `cryoshield-web`, `development` for `cryoshield-web-dev`. It SHALL be referenced only by the `deploy` and `rollback` steps of that target's workflow's release job. Build configuration SHALL live only in the target's build environment (`production-build` or `development-build`), with the bundler URL as an environment secret. Release jobs SHALL run no build tooling.

#### Scenario: Dev workflow asks for production
- **WHEN** `deploy-dev.yml` gains a job in environment `production` or `production-build`
- **THEN** the workflow policy check fails

### Requirement: Smoke test and automatic rollback per target
After every deployment, the pipeline SHALL verify the target's live site:
- `/`, `/app/`, `/architecture`, `/devices`, `/support`, `/privacy` and `/healthz` return 200;
- the security headers are present;
- `/architecture` shows the registry address from `contracts/deployments/<chainId>.json`;
- `/support` shows the configured donation address only;
- `/release.json` reports the deployed commit.

On development, every page MUST carry `X-Robots-Tag: noindex, nofollow`. On production, no page may carry a noindex header. On any failure, the pipeline MUST redeploy the target's previously live image and then fail the run.

#### Scenario: Dev Caddyfile on production
- **WHEN** a production release serves `X-Robots-Tag: noindex`
- **THEN** the smoke test fails, the previous production image is redeployed, and the run fails

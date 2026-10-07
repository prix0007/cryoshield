# continuous-deployment Specification

## Purpose
Deploy every tested commit on `main` to production automatically. Detect which commit is live, verify the deployment, and roll back automatically when it fails.

## Requirements

### Requirement: Deploy main to development after full CI
Every new commit on `main` SHALL be deployed to the development site within about 15 minutes, whether a person or auto-merge merged it. The development site is `https://cryoshield-web-dev.fly.dev` (Fly app `cryoshield-web-dev`) on OP Sepolia. The full CI MUST first pass on that exact commit. The deployment SHALL need no approval, and MUST NOT start from a pull request or from a ref other than `main`. It SHALL use the GitHub Environments `development-build` (build config) and `development` (Fly token only), both deployable from `main` only.

#### Scenario: Auto-merge reaches dev
- **WHEN** a pull request is merged by GitHub auto-merge
- **THEN** within 15 minutes the scheduled run tests the merge commit and deploys it to `https://cryoshield-web-dev.fly.dev`, and production is unchanged

#### Scenario: Nothing new
- **WHEN** `https://cryoshield-web-dev.fly.dev/release.json` already reports `main`'s HEAD commit
- **THEN** the run skips CI and deployment

### Requirement: Development releases follow main
A development release SHALL NOT deploy a commit that is no longer `main`'s HEAD. This is checked when the run starts, and again in the step immediately before `fly deploy`. A superseded release SHALL deploy nothing and end successfully with a notice. Development and production SHALL use separate concurrency groups, so neither ever cancels or queues behind the other.

#### Scenario: Main moves during a dev run
- **WHEN** commit A's dev release is about to deploy and `main` has moved on to B
- **THEN** A's release deploys nothing and ends green with a "Superseded" notice, and B's run deploys B

### Requirement: Development site isolation
The development site SHALL be served from `https://cryoshield-web-dev.fly.dev`, a registrable domain other than `cryoshield.app` (`fly.dev` is a public suffix), and its build SHALL use that host as its WebAuthn RP ID. WebAuthn then cannot assert `rpId` `cryoshield.app` from a development page. No host that is `cryoshield.app` or a subdomain of it SHALL serve the development site. The deploy script and the context generator MUST refuse such a development host, and the deploy script MUST refuse a development build whose configured RP ID is `cryoshield.app` or under it, differs from `cryoshield-web-dev.fly.dev`, or whose bundle carries another RP ID. Every response from the development host SHALL carry `X-Robots-Tag: noindex, nofollow`; this header is the only indexing control, and the development deploy MUST NOT add a `robots.txt` of its own (a static one would also ship to production). The strict CSP and the other security headers stay unchanged. The development build SHALL carry no analytics beacon.

#### Scenario: Production RP ID on dev
- **WHEN** `development-build` sets `VITE_RP_ID=cryoshield.app` or `VITE_RP_ID=dev.cryoshield.app`
- **THEN** `deploy.sh` refuses the build, and nothing is deployed

#### Scenario: Dev code asks for a production credential
- **WHEN** code served from `https://cryoshield-web-dev.fly.dev` calls `navigator.credentials.get` with `rpId: 'cryoshield.app'`
- **THEN** the browser rejects the call, because `cryoshield.app` is not a registrable-domain suffix of the dev origin, and no PRF output for a production vault is produced

#### Scenario: Retired subdomain
- **WHEN** a request reaches the development app with Host `dev.cryoshield.app`
- **THEN** it is redirected to `https://cryoshield-web-dev.fly.dev`, and the app is not served on that host

#### Scenario: Dev is crawled
- **WHEN** a crawler fetches any page of `https://cryoshield-web-dev.fly.dev`
- **THEN** the response carries `X-Robots-Tag: noindex, nofollow`

### Requirement: Production releases from published tags
Production (`https://cryoshield.app`, Fly app `cryoshield-web`) SHALL be deployed only in two cases:
- a GitHub Release is published for a tag matching `v<major>.<minor>.<patch>[-<pre>]`;
- the repository owner dispatches the production workflow **at** such a tag (`--ref vX.Y.Z`), to redeploy or roll back.

In both cases the run's own ref MUST be the `v*` tag; the tag SHALL be taken from that ref, never from an input.

The tagged commit MUST be reachable from `main`'s HEAD, or the run MUST fail before any build. The full CI MUST pass on the tagged commit, the build MUST use `production-build`, and the release MUST run in `production`. Right before deploying, the release MUST re-check that the tag still points at the built commit and that the commit is still reachable from `main`. Production SHALL use the chain configured in `production-build`, and no chain SHALL be hardcoded in the workflow. Releases SHALL NOT be polled.

#### Scenario: Owner publishes a release
- **WHEN** the owner runs `gh release create v1.2.0 --target main --generate-notes`
- **THEN** the production workflow runs the full CI on the tagged commit, builds it and deploys it to `https://cryoshield.app`

#### Scenario: Tag not on main
- **WHEN** a release is published for a tag whose commit is not an ancestor of `main`'s HEAD
- **THEN** the run fails in its first job, and nothing is built or deployed

#### Scenario: Rollback to an earlier release
- **WHEN** the owner runs `gh workflow run deploy.yml --ref v1.1.0`
- **THEN** the production workflow tests, builds and deploys the commit of `v1.1.0`

#### Scenario: Dispatch from a branch
- **WHEN** anyone dispatches the production workflow on `main` or any other branch
- **THEN** its first job is skipped, and no job can obtain `production` or `production-build` secrets, because those environments accept only `v*` tags

#### Scenario: Merge to main
- **WHEN** a pull request is merged into `main`
- **THEN** the production workflow does not run

### Requirement: Only the owner can trigger production
Creating, updating and deleting tags `refs/tags/v*` SHALL be restricted by a tag ruleset, kept as code and synced by `.github/rulesets/apply.sh`, whose only bypass actor is the repository admin role. The production workflow SHALL run only when the triggering actor is the repository owner. The `production` and `production-build` environments SHALL be deployable ONLY from `v*` tags, with no branch policy at all (not even `main`), so the only path to production secrets is a tag that only an admin can create.

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

# Proposal

## Why

The founder asked for "a pipeline which automatically deploys from main branch on PR merges after testing it on main". Today `cryoshield.app` is deployed by hand with `apps/web/deploy/deploy.sh`, so `main` and production drift, and every release depends on one laptop.

A merge done by GitHub auto-merge (enabled with the workflow token) does not start `push` workflows. So a push trigger alone would miss exactly the merges that `adopt-ecc-review-and-auto-merge` automates.

## What Changes

- **`.github/workflows/deploy.yml`** runs on `push` to `main`, on a `schedule` every 15 minutes (to catch bot merges), and on `workflow_dispatch`. It uses `concurrency: deploy-production` and never cancels an in-progress deploy. Its jobs:
  1. **`detect`:** reads the commit currently served at `https://cryoshield.app/release.json` and compares it with the `main` HEAD. If they are equal, everything else is skipped.
  2. **`test`:** runs the full `ci.yml` on that exact SHA. `ci.yml` becomes callable (`workflow_call`, `full: true` forces every area job on), so PR CI and deploy CI cannot drift.
  3. **`deploy`:** in the GitHub Environment `production`, it:
     - writes `apps/web/.env` from environment variables, with the bundler URL as an environment secret (masked in logs; the key itself is public in the bundle and protected by Pimlico's origin restriction);
     - installs flyctl, pinned by version and SHA-256;
     - records the live image for rollback;
     - runs the existing guarded `deploy.sh`;
     - uploads `release-manifest.json` as an artifact and writes the commit and tree hash to the job summary.
  4. **`smoke`:** checks the live routes (`/`, `/app/`, `/architecture`, `/privacy`, `/healthz`), the security headers, the registry address on `/architecture`, and that `/release.json` equals the deployed SHA. On failure it rolls back to the previous image automatically, then fails loudly.
- **`/release.json`:** served by the site and written at deploy time. It holds the commit, tree hash and public config summary, with no secrets. It is the source of truth for `detect`, and it doubles as public verifiability: anyone can see which commit is live. Caddy serves it `no-store`, and container tests cover it.
- **Tested scripts** in `.github/scripts/deploy/`: `detect.sh`, `previous-image.sh`, `smoke.sh` and `rollback.sh`.
- **Workflow policy:**
  - `deploy.yml` may not use `pull_request*` triggers;
  - its secret-holding jobs must use environment `production`;
  - `FLY_API_TOKEN` may appear only in the `deploy` and `rollback` steps;
  - no other workflow may reference `FLY_API_TOKEN` or the `production` environment.
- **Docs:**
  - `docs/deploy.md` runbook: setup, manual deploy, rollback, token rotation;
  - CLAUDE.md "Change flow";
  - README;
  - the system-design pipeline section.
- **Runtime dependencies: none new.** The site stays a static Caddy container on Fly. GitHub Actions is CI/CD, not a CryoShield-operated backend.
- **New CI dependencies:**
  - flyctl 0.4.111 (checksummed);
  - `actions/upload-artifact` v7.0.1 (SHA-pinned);
  - a Fly deploy token scoped to `cryoshield-web`, held only in the `production` environment.

**Out of scope:**
- creating credentials, the environment or variables (the founder runs the documented commands);
- preview or staging environments;
- deploying the contracts or the recovery tool;
- GitHub release creation (the manifest is an artifact, and `/release.json` is public).

## Capabilities

### New Capabilities
- `continuous-deployment`: automatic, tested deployment of `main` to production, with change detection, a smoke test and automatic rollback.

### Modified Capabilities
- `web-hosting`: the site serves `/release.json` identifying the deployed commit and tree hash.
- `ci-pipeline`: CI is reusable as a full run on a given commit, and the policy restricts deployment credentials.

## Impact

- **New:**
  - `.github/workflows/deploy.yml`;
  - `.github/scripts/deploy/*.sh` and their tests;
  - `docs/deploy.md`.
- **Edited:**
  - `.github/workflows/ci.yml` (`workflow_call`);
  - `.github/scripts/workflow-policy.mjs` and its tests;
  - `apps/web/deploy/{deploy.sh,gen-context.mjs,release-manifest.mjs}` and their tests;
  - `CLAUDE.md`, `README.md` and `docs/system-design.md`.
- **Actions minutes:** none to worry about. The repository is public, so the 15-minute `detect` poll is free (design decision 2).
- **Merge order:** this branch and `ci/ecc-review-auto-merge` both edit `workflow-policy.mjs`, `ci.yml` and `CLAUDE.md`, so whichever merges second needs a rebase.

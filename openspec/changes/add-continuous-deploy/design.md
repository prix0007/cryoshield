# Design

## Context

- `deploy.sh` (from `add-fly-hosting`) is the guarded manual deploy. It refuses on:
  - a dirty tree;
  - exported `VITE_*` variables;
  - shadow `.env.*` files;
  - an RP ID that differs from the host;
  - a non-reproducible or failing build.

  It then generates the Caddy context and the release manifest and runs `fly deploy --remote-only`.
- `ci.yml` path-filters area jobs on PRs and runs everything on `push` to `main`.
- Auto-merge (`adopt-ecc-review-and-auto-merge`) merges with the workflow token. GitHub then starts no `push` workflow, and only `workflow_dispatch` and `repository_dispatch` are exempt from that rule.
- `fly releases --json --image` returns `[{Version, Status, ImageRef: "registry.fly.io/cryoshield-web:deployment-<ULID>", …}]`, newest first. This was checked read-only against the live app on 2026-10-04.

## Goals / Non-Goals

**Goals:**
- Every commit on `main` is live within about 15 minutes, only after the full CI passes on that commit.
- Production credentials are reachable only from `main`, in one environment, in two steps.
- A failed release reverts by itself.

**Non-Goals:**
- Staging or preview environments.
- Blue/green deploys.
- Contract deployment.

## Decisions

### 1. Triggers and concurrency

`push` to `main` covers human merges. `schedule: */15 * * * *` covers bot merges, plus any missed push. `workflow_dispatch` adds a `force` input for redeploys.

The workflow has one `concurrency: { group: deploy-production, cancel-in-progress: false }`, so a running deploy is never cancelled and a newer run waits.

Every job is restricted to `github.ref == 'refs/heads/main'`. This matters for `workflow_dispatch` from other refs.

### 2. Polling cost

The repository is public, so GitHub Actions minutes are free, and the 15-minute schedule (96 short `detect` runs a day) costs nothing. The cadence is one cron line if that ever changes.

*Alternative:* have auto-merge use a GitHub App token, so merges emit `push`. Rejected for now: it needs another long-lived credential.

### 3. Deployed-commit source: `/release.json`

At deploy, `release-manifest.mjs --site-release` writes `site/release.json`: name, commit, `treeHash` and the public config summary, without the per-file list. The full manifest stays an artifact.

`treeHash` is computed before `release.json` is added, so it covers every served file except `release.json`. The existing rebuild-and-compare procedure keeps working.

Caddy sets `Cache-Control: no-store` for `/release.json`, and the error handler and global headers keep every security header.

`detect` treats a missing, unparseable or invalid `/release.json` as "deploy". It fails safe toward deploying, and the deploy itself is fully gated. *Alternatives:* `fly releases` metadata or image labels. Rejected because they need the Fly token in `detect` and are not publicly verifiable.

### 4. Reusable CI

`ci.yml` gains `on.workflow_call.inputs.full` (boolean). Every area job and `workflow-lint` run when `inputs.full` is true. `changes` and `pr-checks` stay PR-only, and `ci-ok` aggregates as before.

The top-level concurrency group becomes `ci-${{ github.workflow }}-…`. In a called run, `github.workflow` is the caller's name, so deploy CI never queues behind (or cancels) push CI on `main`.

The deploy workflow's `test` job grants `contents: read` and `pull-requests: read`, the maximum the called jobs declare.

### 5. Deploy job

It runs in environment `production`, with `permissions: contents: read`, after `test`, at the SHA `detect` resolved. The steps are:
1. Check out at `needs.detect.outputs.sha` with `persist-credentials: false`. Set up pnpm and Node (pinned as in `ci.yml`), then `pnpm install --frozen-lockfile`.
2. Install flyctl 0.4.111 from the GitHub release, verified with `sha256sum -c` (`1878d7fb…9aa9e`). Put it on `PATH` as `fly`.
3. **`web-env`:** write `apps/web/.env` from the `vars.VITE_*` values in this step's env.
   - The bundler URL comes from the environment secret `VITE_BUNDLER_URL`, masked.
   - `VITE_CF_BEACON_TOKEN` is optional.
   - Values are validated (no newlines). The keys are listed in `docs/deploy.md`.
   - The deploy step's env has no `VITE_*`, because `deploy.sh` refuses exported `VITE_*` variables.
4. **`deploy`:** the only step with `FLY_API_TOKEN`.
   - `previous-image.sh` records the live `ImageRef` (validated) as an output.
   - Then `apps/web/deploy/deploy.sh` runs unchanged, apart from `--site-release`. `fly` reads `FLY_API_TOKEN` from the env, so the script needs no interactive changes. Its clean-tree check passes because `.env`, `node_modules` and `deploy/.build` stay untracked or ignored.
5. Upload `release-manifest.json` as an artifact (90 days), and write the commit and `treeHash` to `$GITHUB_STEP_SUMMARY`.

### 6. Smoke and rollback job

It needs `deploy` and runs in environment `production`. Only its `rollback` step uses the token.

`smoke.sh` retries the whole suite. The defaults are 10 attempts, 15 seconds apart, which covers Fly rolling updates and machine resume. The checks are:
- `/`, `/app/`, `/architecture`, `/privacy`, `/healthz` → 200;
- on `/` and `/app/`: CSP with `frame-ancestors 'none'`, HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, COOP and CORP;
- `/architecture` contains the registry address, case-insensitive;
- `/release.json` `.commit` equals the SHA.

On failure, `rollback.sh` validates the previous `ImageRef`. It then runs `fly deploy --app cryoshield-web --config apps/web/fly.toml --image <ref>` and checks that `/healthz` answers. Finally it fails the job with the smoke error. With no previous image, it fails loudly without a rollback.

The scripts take `FLY`, `CURL_OPTS` and `BASE_URL` overrides so they can be tested against a stub `fly` and a local HTTP server.

### 7. Policy (`workflow-policy.mjs`)

For `deploy.yml`:
- triggers must be a subset of `push`, `schedule`, `workflow_dispatch`, and `push` must be limited to `main`;
- every job that uses a non-`GITHUB_TOKEN` secret must have `environment: production`;
- `FLY_API_TOKEN` is allowed only in step-level env of steps with `id: deploy` or `id: rollback`;
- `secrets: inherit` is forbidden, and so is a top-level concurrency other than `deploy-production` with `cancel-in-progress: false`.

Every other workflow:
- may not mention `FLY_API_TOKEN` or `environment: production`.

The existing rules still apply: read-only job permissions, timeouts, top-level `contents: read`.

### 8. Pins

- **flyctl 0.4.111:** `flyctl_0.4.111_Linux_x86_64.tar.gz`, sha256 `1878d7fb1f8a418039042cf0749e4b7216c6c7018b66ae10611a64c2b6d9aa9e`. Verified against the release's `flyctl_0.4.111_checksums.txt`.
- **`actions/upload-artifact` v7.0.1:** `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`.
- The other actions use the same pins as `ci.yml`.

## Threats / abuse

| Threat | Mitigation |
|---|---|
| A PR deploys or steals the Fly token | No PR triggers (enforced by the policy). The environment is restricted to the `main` branch by its deployment-branch policy. The token appears only in two steps, in one workflow. |
| An unreviewed commit is deployed | Only `main` is deployed, and `main` is ruleset-protected: PR, `ci-ok` and, later, `ecc-review`. The full CI runs again on the exact SHA before deploy. |
| Token blast radius | A Fly *deploy* token, scoped to the one app, with a 1-year expiry and a rotation procedure in `docs/deploy.md`. |
| Build config leaks | Variables are public config already visible in the bundle. The bundler URL (containing the Pimlico key) is a masked secret, and the key is origin-restricted at Pimlico. The release manifest records origins only. |
| A forged `/release.json` makes `detect` skip a deploy | The worst case is a delayed deploy, which `workflow_dispatch` with `force` fixes. Serving content on our domain already implies full compromise. |
| A broken release stays live | The smoke test triggers automatic rollback to the recorded image, and the run fails. |
| A malicious flyctl download | Pinned version plus SHA-256 check before use. |
| Concurrent deploys | One concurrency group, never cancelled. |

## Risks / Trade-offs

- **The rollback restores the previous image only.** It cannot fix a bad DNS or certificate state. Documented in the runbook.
- **The first deploy after merge always runs,** because the current site has no `/release.json` yet.
- **The `production` environment must exist** (founder setup). Until it does, `deploy` fails with a clear missing-token error after `test` passes, and nothing is deployed.

## Migration Plan

1. The founder runs the setup commands in `docs/deploy.md`: create the environment with a `main`-only branch policy, set the deploy token and the variables.
2. Merge this change. The push run deploys and creates `/release.json`.
3. Verify with `curl https://cryoshield.app/release.json`.

Rollback of the pipeline: disable the workflow (`gh workflow disable deploy.yml`). Manual `deploy.sh` keeps working.

## Implementation notes (apply, 2026-10-04)

- **The CLAUDE.md "Change flow" deploy step** was added after rebasing onto `adopt-ecc-review-and-auto-merge` (#16), which introduced CLAUDE.md.
- **`detect` also takes `MAIN_SHA`** from `GET repos/{repo}/commits/main`. A run whose `github.sha` is no longer the `main` HEAD is "superseded" and skips, so an older commit can never replace a newer one. This is needed because the reusable CI tests `github.sha`.
- **`write-env.sh` (tested) generates `apps/web/.env`.**
  - Required keys must be present, values may not contain line breaks, and an existing file is never overwritten.
  - The file is written `0600`, and the bundler URL is masked in the log.
  - The optional keys are `VITE_ARWEAVE_FAST_INDEX_URL` and `VITE_CF_BEACON_TOKEN`.
- **zizmor pedantic suggests `uses: $/.github/workflows/ci.yml`.** The CI-pinned actionlint 1.7.12 rejects it (rhysd/actionlint#711 and #732 are open), so the call stays `./…`. The one zizmor ignore is `self-repository` at `deploy.yml:74`, and the policy allows only that.
- **The `/architecture` page in `apps/web` is not changed.** It is the frontend's, and the pipeline section lives in `docs/system-design.md`.
- **Local results:**
  - `.github/scripts` tests: 129/129;
  - web deploy tests: manifest, gen-context, deploy-sh and fly-toml, plus the Docker container test (53 passed, including `/release.json`);
  - actionlint and shellcheck: clean;
  - zizmor pedantic: 0 findings (1 ignored);
  - policy: OK;
  - `openspec validate --all --strict` and the licence check: pass;
  - gitleaks on the branch range: no leaks.

## Security review (2026-10-04)

The security reviewer verdict was **APPROVE WITH FIXES**. Confirmed sound:
- only tested `main` commits deploy (implicit `success()`, the same `github.sha` throughout, the superseded check);
- the environment API fields in the runbook are correct;
- flyctl checksum and action pins;
- `/release.json` holds no keys, is `no-store`, and is correctly excluded from `treeHash`;
- `inputs.full` and the permissions of the called jobs.

Every finding below was fixed test-first (red, then green).

### HIGH

1. **The Fly token was in the same step as third-party build code.** `deploy.sh` runs `vite build`, its plugins and their dependencies with `FLY_API_TOKEN` in the environment. A compromised build dependency could take the one-year token and deploy a phishing build at will. Splitting steps within one job is not enough, because a build step can write to `$GITHUB_ENV` and `$GITHUB_PATH`.

   Fix: the work is split into two jobs.
   - **`build`** (no token) runs `deploy.sh --build-only`. This new flag runs every guard and build step but no `fly` (tested), and the job uploads `deploy/.build`.
   - **`deploy`** holds the token and runs only `actions/checkout`, `actions/download-artifact`, shell, `curl`, `jq` and pinned flyctl.
     - Before `fly deploy`, it re-verifies the artifact: the manifest commit, the recomputed `treeHash`, and the `release.json` commit.
     - The policy rejects any other action, and any node, npm, pnpm, vite, python, make or docker invocation, in a job that holds the token.

### MEDIUM

2. **A failed `fly deploy` was never rolled back.** If `fly deploy` failed partway, or a later deploy step failed, nothing rolled back.
   - Fix: `deploy` sets `fly_started=true` just before `fly deploy`. `smoke` now runs `if: always()` when `deploy` succeeded, or failed after `fly_started`. Rollback runs on any failure in `smoke`, or on a failed `deploy`, once `fly_started` is set. This also fixes LOW-3.
3. **A failing commit was retried every 15 minutes.**
   - Fix: `detect` (with `actions: read`) looks up earlier Deploy runs of the SHA. If a `deploy` or `smoke` job failed, it skips unless `force` is set (`PREVIOUSLY_FAILED` in `detect.sh`, tested).
4. **The policy could be bypassed.** Fixes:
   - environment names are compared case-insensitively and may not be expressions;
   - `deploy.yml` allows only the exact expressions `secrets.FLY_API_TOKEN` (step env of `deploy` and `rollback`) and `secrets.VITE_BUNDLER_URL` (step env of `web-env`), in `production` jobs only. `secrets[...]`, `toJSON(secrets)` and other names are rejected.
5. **Nothing checked the branch policy existed.**
   - Fix: setup step 5 in `docs/deploy.md` is a hard gate: it prints `OK` only when the custom policy is the single `branch:main` rule.
   - The runbook says to create the policy and pass the check before setting secrets, and not to merge before then.

### LOW

- **L1:** a rollback uses the new commit's `fly.toml`. This is documented, with the manual alternative.
- **L2:** `write-env.sh` rejects `$` (Vite's dotenv expansion would rewrite the value; tested).
- **L3:** fixed with item 2.

### Unrelated observation

The reviewer saw 2 failures in `apps/web/deploy/test/verify-real-env.test.ts` ("Missing required build variable(s)") in a worktree without `apps/web/.env`. That file is not touched by this change, and the failure comes from the local environment. CI does not run `test:deploy`.

### New pin

`actions/download-artifact` v8.0.1 = `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c`.

### zizmor ignore

The `self-repository` ignore moved to `deploy.yml:87`.

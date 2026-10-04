# Deploy runbook: cryoshield.app

This covers continuous deployment of `main` to Fly.io (OpenSpec changes `add-continuous-deploy` and `gate-production-deploys`). Merges stay automatic, but **every production release waits for the owner's one-click approval**. The hosting details, DNS and certificates are in [`apps/web/deploy/README.md`](../apps/web/deploy/README.md).

## How it works

`.github/workflows/deploy.yml` runs on:
- every push to `main` (human merges);
- every 15 minutes (merges made by GitHub auto-merge start no push workflow; the repository is public, so Actions minutes are free);
- on demand.

It has five stages:

| Stage | What |
|---|---|
| `detect` | Reads `https://cryoshield.app/release.json`. If it already names the `main` HEAD, or if `main` moved on (a newer run owns the deploy), the run stops here. |
| `test` | The **full** `ci.yml` (`workflow_call`, `full: true`) on that exact commit: every area job, no path filters. |
| `build` | Runs in the GitHub Environment `production-build` (build config only, `main` only, no approval) and **never sees the Fly token**. It writes `apps/web/.env` from the environment's variables, then runs `apps/web/deploy/deploy.sh --build-only`. That run applies every guard (clean tree, RP ID equals host, two identical production builds, bundle checks) and produces `deploy/.build`: the site, the Caddyfile, the release manifest and `release.json`. The result is uploaded as an artifact. |
| `supersede` | Cancels **older** Deploy runs, for other commits, that are still waiting for approval (`.github/scripts/deploy/supersede.sh`). It runs only after this commit passed the full CI and built, and it never touches a run that is deploying. |
| `release` | The only job in the Environment `production`, so it **waits for the owner's approval**. One approval covers the whole release. The job holds the Fly token and runs **no node, pnpm or build code** (enforced by the workflow policy). It downloads the artifact, checks the manifest's commit and tree hash against the files, records the live image, runs `fly deploy` with pinned, checksummed flyctl, then smoke-tests `/`, `/app/`, `/architecture`, `/privacy`, `/healthz`, the security headers, the registry address and `/release.json`. If the deploy or the smoke test fails, or the job is cancelled after `fly deploy` started, it **rolls back automatically** to the previous image in the same job, with no second approval, and fails the run. |

**Concurrency.**
- Runs for the same commit share the group `deploy-<sha>`. While one waits for approval, the 15-minute schedule adds at most one pending run behind it, and that run stops at `detect` once the release is live.
- Only one release holds `deploy-production` at a time (waiting or deploying), and it is never cancelled by concurrency.
- A newer commit tests and builds in parallel, then supersedes an older release that is still waiting, so an approval is never spent on a stale commit.

The pipeline never runs on pull requests, and `workflow-policy.mjs` enforces that in CI.

## Approving a release [owner]

You get a GitHub notification ("Deployment review required") when a release is waiting.

**In the browser:**
1. Go to Actions → Deploy, and open the run that shows *Waiting*.
2. Before approving, check the commit and the build summary (commit and tree hash).
3. Click **Review deployments**, tick `production`, then click **Approve and deploy**. *Reject* ends the run. A rejected commit is not retried automatically; fix forward, or force a redeploy.

**From the CLI:**

```sh
gh run list --workflow deploy.yml --status waiting                                  # find the run id
gh api repos/prix0007/cryoshield/actions/runs/<run-id>/pending_deployments \
  --jq '.[] | "\(.environment.id) \(.environment.name) can_approve=\(.current_user_can_approve)"'
gh api -X POST repos/prix0007/cryoshield/actions/runs/<run-id>/pending_deployments \
  -F 'environment_ids[]=<environment-id>' -f state=approved -f comment='release <short-sha>'
```

Use `state=rejected` to reject. Only the owner can approve: admins cannot bypass the reviewer rule (`can_admins_bypass: false`), and the agents' machine account has Write only (`docs/agent-account.md`).

A release left waiting is harmless. Nothing is deployed, the next commit's run supersedes it, and GitHub expires it after 30 days.

A commit whose deploy or smoke test failed, or whose release was rejected, is **not retried** by the 15-minute schedule. Fix forward with a new commit, or redeploy it on purpose with `gh workflow run deploy.yml --ref main -f force=true`.

**Which commit is live?** Run `curl -s https://cryoshield.app/release.json`. It returns the commit, the `treeHash` and the public config.

## First-time setup [founder]

Run these once, from a checkout that has the real `apps/web/.env`. None of them prints a secret value.

> **Order matters.** The branch policies (step 1) keep the secrets away from any other branch: a workflow pushed on a feature branch could otherwise ask for either environment. Create them, run the step 5 check, and only then set secrets.

**1. Create both environments, deployable from `main` only.** `production` gets the owner as required reviewer with no admin bypass; `production-build` holds the build config with no reviewer. The script is idempotent, and without `--apply` it only prints the diff.

```sh
.github/rulesets/apply.sh --with-ecc-review --environments           # dry run
.github/rulesets/apply.sh --with-ecc-review --environments --apply
```

**2. Fly deploy token**, scoped to the `cryoshield-web` app and valid for one year. It is stored only in `production`.

```sh
fly tokens create deploy -a cryoshield-web --expiry 8760h --name github-actions-deploy \
  | gh secret set FLY_API_TOKEN --env production
```

**3. Bundler URL** (it contains the Pimlico key). It is stored as an environment secret only to keep it out of logs and the repo. It is **not** confidential: Vite inlines it into the public JS bundle, so anyone can read it from the site. The real control is Pimlico's dashboard, which must restrict the key to the origin `https://cryoshield.app` and to bundler/paymaster methods, with a sponsorship policy capping spend (`apps/web/docs/paymaster-policy.md`). The build artifact containing the bundle is kept for 7 days only.

```sh
grep '^VITE_BUNDLER_URL=' apps/web/.env | cut -d= -f2- | gh secret set VITE_BUNDLER_URL --env production-build
```

**4. The other build settings, as `production-build` variables.**

- Required: `VITE_CHAIN_ID`, `VITE_RPC_URL`, `VITE_SPONSORSHIP_POLICY_ID`, `VITE_TURBO_UPLOAD_URL`, `VITE_ARWEAVE_GATEWAY_URL`, `VITE_RP_ID`, `VITE_RP_NAME`.
- Optional: `VITE_ARWEAVE_FAST_INDEX_URL`, `VITE_CF_BEACON_TOKEN`.

```sh
for k in VITE_CHAIN_ID VITE_RPC_URL VITE_SPONSORSHIP_POLICY_ID VITE_TURBO_UPLOAD_URL \
         VITE_ARWEAVE_GATEWAY_URL VITE_ARWEAVE_FAST_INDEX_URL VITE_RP_ID VITE_RP_NAME VITE_CF_BEACON_TOKEN; do
  v="$(grep "^$k=" apps/web/.env | tail -n 1 | cut -d= -f2-)"
  [ -n "$v" ] && gh variable set "$k" --env production-build --body "$v"
done
```

**5. Check (names only).** This is a hard gate: it must print `OK`. Run it after step 1, and again at the end.

```sh
.github/rulesets/apply.sh --with-ecc-review --environments && echo OK   # in sync: reviewer, no bypass, main only
gh secret list --env production            # FLY_API_TOKEN only
gh secret list --env production-build      # VITE_BUNDLER_URL only
gh variable list --env production-build    # the VITE_* names above
gh variable list --env production          # nothing
```

**Moving from the old layout** (before `gate-production-deploys`, the build config was in `production`): run steps 1, 3 and 4 (they write `production-build`), run the check, then delete the old copies from `production`:

```sh
gh secret delete VITE_BUNDLER_URL --env production
for k in $(gh variable list --env production --json name --jq '.[].name'); do gh variable delete "$k" --env production; done
```

Until `production-build` has its variables, `build` fails and nothing is deployed (fail closed).

**Optional hardening** (Dependabot security updates, and actions must be pinned to a full commit SHA): `.github/rulesets/apply.sh --with-ecc-review --environments --founder-hardening`, then again with `--apply`.

## Manual deploy

There are two ways:
- **Through the pipeline (preferred):** `gh workflow run deploy.yml --ref main -f force=true`. It runs the same full CI, deploy and smoke test.
- **From a laptop** (pipeline disabled or GitHub down): `apps/web/deploy/deploy.sh` with a real `apps/web/.env` and `fly auth login`. See `apps/web/deploy/README.md`. The next scheduled run then sees `/release.json` and does nothing if the commit matches `main`.

## Rollback

- **Automatic:** when the smoke test fails, the `release` job redeploys the image that was live before the deploy (`fly releases --json --image`, validated) and fails the run. The job summary shows the rollback outcome.
- **Manual:** use this if automatic rollback was impossible (for example on the first deploy) or if a later problem shows up.

  ```sh
  fly releases --app cryoshield-web --image          # read-only: pick the last good ImageRef
  fly deploy --app cryoshield-web --config apps/web/fly.toml --image registry.fly.io/cryoshield-web:deployment-<ID>
  curl -s https://cryoshield.app/release.json         # confirms which commit is live again
  ```
- **Pause deploys** while you fix `main`: `gh workflow disable deploy.yml`, then later `gh workflow enable deploy.yml`. Reverting the bad commit on `main` through a PR also works: the pipeline deploys the revert.
- **Take the site offline:** `fly scale count 0 --app cryoshield-web`. Vaults are on-chain, and the desktop recovery tool keeps working.

A rollback restores the previous *image* only.
- It uses the **new** commit's `apps/web/fly.toml`. If the bad change was in `fly.toml` itself, revert that file in a PR, or deploy the old image with the old config by hand (`git show <old-commit>:apps/web/fly.toml > /tmp/fly.toml`, then `fly deploy --config /tmp/fly.toml --image ...`).
- It cannot fix DNS, certificates or Fly app settings.

## Rotating the Fly token

Rotate once a year, before `--expiry`, or at once if the token may have leaked:

```sh
fly tokens list -a cryoshield-web                                   # find the old token's ID
fly tokens create deploy -a cryoshield-web --expiry 8760h --name github-actions-deploy \
  | gh secret set FLY_API_TOKEN --env production                    # replace the secret
fly tokens revoke <old-token-id>                                    # then revoke the old one
gh workflow run deploy.yml --ref main -f force=true                 # prove the new token works
```

A token rotation, like any deploy, waits for your approval. If the Pimlico key changes, re-run step 3 of the setup. If any other value changes, re-run step 4 and then a forced deploy.

# Deploy runbook: cryoshield.app

This covers continuous deployment of `main` to Fly.io (OpenSpec change `add-continuous-deploy`). The hosting details, DNS and certificates are in [`apps/web/deploy/README.md`](../apps/web/deploy/README.md).

## How it works

`.github/workflows/deploy.yml` runs on:
- every push to `main` (human merges);
- every 15 minutes (merges made by GitHub auto-merge start no push workflow; the repository is public, so Actions minutes are free);
- on demand.

It has four stages:

| Stage | What |
|---|---|
| `detect` | Reads `https://cryoshield.app/release.json`. If it already names the `main` HEAD, or if `main` moved on (a newer run owns the deploy), the run stops here. |
| `test` | The **full** `ci.yml` (`workflow_call`, `full: true`) on that exact commit: every area job, no path filters. |
| `build` | Runs in the GitHub Environment `production` and **never sees the Fly token**. It writes `apps/web/.env` from the environment's variables, then runs `apps/web/deploy/deploy.sh --build-only`. That run applies every guard (clean tree, RP ID equals host, two identical production builds, bundle checks) and produces `deploy/.build`: the site, the Caddyfile, the release manifest and `release.json`. The result is uploaded as an artifact. |
| `deploy` | Holds the Fly token, and runs **no node, pnpm or build code**; the workflow policy enforces this. It downloads the artifact, checks the manifest's commit and tree hash against the files, records the live image, and runs `fly deploy` with pinned, checksummed flyctl. The commit and tree hash go into the job summary. |
| `smoke` | Checks `/`, `/app/`, `/architecture`, `/privacy` and `/healthz` (200), the security headers, the registry address on `/architecture`, and that `/release.json` names the deployed commit. On failure, including a `deploy` that failed after `fly deploy` started, it **rolls back automatically** to the previous image and fails the run. |

Only one deploy runs at a time (`concurrency: deploy-production`), and a running deploy is never cancelled. The pipeline never runs on pull requests, and `workflow-policy.mjs` enforces that in CI.

A commit whose deploy or smoke test failed is **not retried** by the 15-minute schedule. Fix forward with a new commit, or redeploy it on purpose with `gh workflow run deploy.yml --ref main -f force=true`.

**Which commit is live?** Run `curl -s https://cryoshield.app/release.json`. It returns the commit, the `treeHash` and the public config.

## First-time setup [founder]

Run these once, from a checkout that has the real `apps/web/.env`. None of them prints a secret value.

> **Order matters.** The branch policy (step 1) is what keeps the Fly token away from any other branch: a workflow pushed on a feature branch could otherwise ask for `production`. Create it, run the step 5 check, and only then set secrets. Do not merge `add-continuous-deploy` before step 5 passes.

**1. Create the `production` environment, deployable from `main` only.**

```sh
gh api -X PUT repos/prix0007/cryoshield/environments/production \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api -X POST repos/prix0007/cryoshield/environments/production/deployment-branch-policies \
  -f name=main -f type=branch
```

**2. Fly deploy token**, scoped to the `cryoshield-web` app and valid for one year. It is stored only in that environment.

```sh
fly tokens create deploy -a cryoshield-web --expiry 8760h --name github-actions-deploy \
  | gh secret set FLY_API_TOKEN --env production
```

**3. Bundler URL** (it contains the Pimlico key), stored as an environment secret so it is masked in logs.

```sh
grep '^VITE_BUNDLER_URL=' apps/web/.env | cut -d= -f2- | gh secret set VITE_BUNDLER_URL --env production
```

**4. The other build settings, as environment variables.**

- Required: `VITE_CHAIN_ID`, `VITE_RPC_URL`, `VITE_SPONSORSHIP_POLICY_ID`, `VITE_TURBO_UPLOAD_URL`, `VITE_ARWEAVE_GATEWAY_URL`, `VITE_RP_ID`, `VITE_RP_NAME`.
- Optional: `VITE_ARWEAVE_FAST_INDEX_URL`, `VITE_CF_BEACON_TOKEN`.

```sh
for k in VITE_CHAIN_ID VITE_RPC_URL VITE_SPONSORSHIP_POLICY_ID VITE_TURBO_UPLOAD_URL \
         VITE_ARWEAVE_GATEWAY_URL VITE_ARWEAVE_FAST_INDEX_URL VITE_RP_ID VITE_RP_NAME VITE_CF_BEACON_TOKEN; do
  v="$(grep "^$k=" apps/web/.env | tail -n 1 | cut -d= -f2-)"
  [ -n "$v" ] && gh variable set "$k" --env production --body "$v"
done
```

**5. Check (names only).** This is a hard gate: it must print `OK`. Run it after step 1, and again at the end.

```sh
policy="$(gh api repos/prix0007/cryoshield/environments/production --jq '.deployment_branch_policy | "\(.protected_branches) \(.custom_branch_policies)"')"
branches="$(gh api repos/prix0007/cryoshield/environments/production/deployment-branch-policies --jq '[.branch_policies[] | "\(.type):\(.name)"] | join(",")')"
[ "$policy" = "false true" ] && [ "$branches" = "branch:main" ] && echo OK || echo "NOT SAFE: policy=$policy branches=$branches"
gh secret list --env production      # FLY_API_TOKEN, VITE_BUNDLER_URL
gh variable list --env production    # the VITE_* names above
```

The first run after this change merges always deploys, because the old site has no `/release.json` yet.

## Manual deploy

There are two ways:
- **Through the pipeline (preferred):** `gh workflow run deploy.yml --ref main -f force=true`. It runs the same full CI, deploy and smoke test.
- **From a laptop** (pipeline disabled or GitHub down): `apps/web/deploy/deploy.sh` with a real `apps/web/.env` and `fly auth login`. See `apps/web/deploy/README.md`. The next scheduled run then sees `/release.json` and does nothing if the commit matches `main`.

## Rollback

- **Automatic:** when the smoke test fails, the `smoke` job redeploys the image that was live before the deploy (`fly releases --json --image`, validated) and fails the run. The job summary shows the rollback outcome.
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

If the Pimlico key changes, re-run step 3 of the setup. If any other value changes, re-run step 4 and then a forced deploy.

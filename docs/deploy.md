# Deploy runbook: dev.cryoshield.app and cryoshield.app

There are two targets (OpenSpec change `split-dev-and-release-deploys`, which builds on `add-continuous-deploy`, `gate-production-deploys` and `remove-production-approval-gate`):

| | Development | Production |
|---|---|---|
| Site | https://dev.cryoshield.app | https://cryoshield.app |
| Fly app / config | `cryoshield-web-dev` / `apps/web/fly.dev.toml` | `cryoshield-web` / `apps/web/fly.toml` |
| Workflow | `.github/workflows/deploy-dev.yml` | `.github/workflows/deploy.yml` |
| Deploys when | every commit on `main` (push, the 15-minute schedule, dispatch) | the **owner publishes a release** `vX.Y.Z` (or dispatches a redeploy of one) |
| Human step | none | the owner's release |
| Environments | `development-build` (config), `development` (Fly token) | `production-build` (config), `production` (Fly token) |
| Chain | OP Sepolia | whatever `production-build` says (OP Sepolia today, OP Mainnet later) |
| WebAuthn RP ID | `dev.cryoshield.app`, **never** `cryoshield.app` | `cryoshield.app` |
| Indexing | `X-Robots-Tag: noindex, nofollow` on every response | indexable |
| Analytics | none (`VITE_CF_BEACON_TOKEN` unset) | Cloudflare beacon, if configured |

The dev site is a testnet sandbox. Vaults created there use the dev RP ID, so they are unrelated to production vaults. Never send users there. The hosting details, DNS and certificates are in [`apps/web/deploy/README.md`](../apps/web/deploy/README.md).

## How it works

Both workflows share one shape. Each stage runs only if the previous one passed:

| Stage | What |
|---|---|
| `detect` | **Dev:** reads `https://dev.cryoshield.app/release.json`. If it already names `main`'s HEAD, or `main` moved on (a newer run owns the deploy), the run stops here. **Production:** runs only if *you* triggered it. It resolves the tag to its commit (`.github/scripts/deploy/release-ref.sh`) and **fails** if the tag is malformed, missing or not reachable from `main`. It also writes the diff from the live commit to the run summary (`release-diff.sh`): a **NOT NEWER THAN LIVE** warning means you are rolling back, and **TOKEN-PATH CHANGED** lists files that change what runs with the Fly token. |
| `config` | Checks that the build environment has every required variable (names only). If not, it warns and skips the rest, and the run still succeeds. |
| `test` | The **full** `ci.yml` (`full: true`) on the exact commit: every area job, no path filters. Production passes `ref:` so that a dispatched rollback tests the tag's commit, not `main`'s HEAD. |
| `build` | In the build environment, **without the Fly token**. It writes `apps/web/.env` from the environment, then runs `DEPLOY_TARGET=<target> apps/web/deploy/deploy.sh --build-only`. That applies every guard: clean tree, RP ID == the target's host (and never the production RP ID on dev), two identical builds, bundle checks. The output is uploaded as an artifact: the site, Caddyfile (with the noindex header for dev only), release manifest and `release.json`. |
| `release` | The only job in the Fly-token environment. It runs **no node, pnpm or build code** (enforced by `workflow-policy.mjs`). It re-checks the commit (dev: still `main`'s HEAD; production: the tag still points at it and it is still on `main`), verifies the artifact against its manifest, records the live image, runs `fly deploy` with pinned, checksummed flyctl, and smoke-tests the site. The smoke test covers the pages, the security headers, the registry and donation addresses and `/release.json`; on dev it also requires the noindex header, and on production it requires its *absence*. On any failure, or a cancellation after `fly deploy` started, it **rolls back automatically** to the previous image and fails the run. |

**Concurrency.**
- Dev runs share `deploy-dev-<sha>` per commit, and the dev release job holds `deploy-development`. A newer commit's pending release replaces an older pending one.
- Production runs share `deploy-release-<tag>`, and the release job holds `deploy-production`.
- Neither is ever cancelled mid-deploy, and dev and production never cancel or wait for each other.

Neither pipeline runs on pull requests, and `workflow-policy.mjs` enforces that in CI.

**Which commit is live?** `curl -s https://dev.cryoshield.app/release.json` and `curl -s https://cryoshield.app/release.json` return the commit, the `treeHash` and the public config (chain, RP ID, registry).

## Releasing to production [owner]

Only the repository owner can ship to production. Three independent layers enforce it:
1. **The tag ruleset `release-tags`** (`.github/rulesets/release-tags.json`): only admins may create, move or delete `v*` tags.
2. **The workflow:** the production run starts only when you trigger it (`github.triggering_actor == github.repository_owner`). This also covers a release published on an existing tag, a dispatch, or a re-run by anyone else.
3. **The environments:** `production` and `production-build` accept only `main` and `v*` tags.

The agents' machine account (Write role) therefore cannot ship to production. Agents never create tags or releases.

**Cut a release** from `main`:

```sh
git fetch origin && git log --oneline origin/main -5          # what you are about to ship
curl -s https://dev.cryoshield.app/release.json               # dev already runs main's HEAD?
gh release create v1.2.0 --target main --generate-notes       # tags main's HEAD and publishes: production deploys
gh run watch "$(gh run list --workflow deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
curl -s https://cryoshield.app/release.json                   # names the released commit
```

- Use semantic versions: `vMAJOR.MINOR.PATCH`, optionally `-rc.N`. Anything else fails at `detect`. Pre-releases deploy too; use them only when you mean it.
- `--target main` tags `main`'s HEAD. To release an older commit on `main`, use `--target <sha>`. A commit that is not on `main` is refused.
- Draft releases do not deploy. Publishing the draft does.
- Read the run summary's **Release review** before or while it deploys. It cannot block: the release is the human step.

**Redeploy or roll back to an earlier release:**

```sh
gh release list --limit 10                     # pick a good tag
gh workflow run deploy.yml -f tag=v1.1.0       # runs from main: full CI on v1.1.0's commit, build, deploy, smoke
```

This works for any `v*` tag on `main`. The CI *definition* comes from `main`, but the code tested and built is the tag's. If today's CI cannot run on a very old tag, cut a fix-forward release instead.

A release whose deploy or smoke test fails rolls back by itself and the run fails. Fix forward with a new release, or redeploy a good tag as above.

## Development deploys

There is nothing to do. Every commit on `main` reaches https://dev.cryoshield.app within about 15 minutes: on push for human merges, on the 15-minute schedule for auto-merges (merges made by the workflow token start no push workflow).
- A commit whose dev deploy or smoke test failed is **not retried** by the schedule. Fix forward, or `gh workflow run deploy-dev.yml --ref main -f force=true`.
- Pause dev deploys: `gh workflow disable deploy-dev.yml`. Resume: `gh workflow enable deploy-dev.yml`.

## First-time setup [owner]

Run these once. None of them prints a secret value.

> **Order matters.** The branch/tag policies (step 1) keep the secrets away from any other branch or tag: a workflow pushed on a feature branch could otherwise ask for an environment. Create them, run the step 6 check, and only then set secrets.

**0. Already done** (2026-10-05): the Fly app `cryoshield-web-dev` (org `cryoshield`, region `sin`), DNS for `dev.cryoshield.app`, and its certificate. To check:

```sh
fly apps list --org cryoshield | grep cryoshield-web-dev
fly certs show dev.cryoshield.app --app cryoshield-web-dev      # Status: Ready
dig +short dev.cryoshield.app A; dig +short dev.cryoshield.app AAAA
```

If you ever need to redo them:
- `fly apps create cryoshield-web-dev --org cryoshield`, then `fly ips allocate-v6 --app cryoshield-web-dev` and `fly ips allocate-v4 --shared --app cryoshield-web-dev`.
- In DNS, add `AAAA dev → <the v6>` and `A dev → <the shared v4>`, both **DNS only** (not proxied).
- Then `fly certs add dev.cryoshield.app --app cryoshield-web-dev`.

**1. Environments and the tag ruleset.** Four environments, with no reviewers and no admin bypass:
- `production` and `production-build`, deployable from `main` and `v*` tags;
- `development` and `development-build`, deployable from `main` only.

The same command also syncs the `release-tags` ruleset (only admins may create, move or delete `v*` tags). It is idempotent, and without `--apply` it only prints the diff.

```sh
.github/rulesets/apply.sh --with-ecc-review --environments           # dry run
.github/rulesets/apply.sh --with-ecc-review --environments --apply
```

**2. Fly deploy tokens**, each an **app-scoped deploy token** (it can deploy only its own app, never the other one or the org), valid for one year:

```sh
fly tokens create deploy -a cryoshield-web-dev --expiry 8760h --name github-actions-deploy-dev \
  | gh secret set FLY_API_TOKEN --env development
fly tokens create deploy -a cryoshield-web --expiry 8760h --name github-actions-deploy \
  | gh secret set FLY_API_TOKEN --env production           # skip if production already has it
```

**3. Bundler URLs** (each contains a Pimlico key). They are environment secrets only to keep them out of logs and the repo. They are **not** confidential: Vite inlines them into the public bundle. The real control is Pimlico's dashboard (`apps/web/docs/paymaster-policy.md`):
- the **production** key is restricted to the origin `https://cryoshield.app`;
- use a **separate dev key**, restricted to `https://dev.cryoshield.app`, with its own small sponsorship cap.

```sh
gh secret set VITE_BUNDLER_URL --env development-build      # paste the dev bundler URL at the prompt
grep '^VITE_BUNDLER_URL=' apps/web/.env | cut -d= -f2- | gh secret set VITE_BUNDLER_URL --env production-build
```

**4. Production build settings, as `production-build` variables.**
- Required: `VITE_CHAIN_ID`, `VITE_RPC_URL`, `VITE_SPONSORSHIP_POLICY_ID`, `VITE_TURBO_UPLOAD_URL`, `VITE_ARWEAVE_GATEWAY_URL`, `VITE_RP_ID` (= `cryoshield.app`), `VITE_RP_NAME`.
- Optional: `VITE_ARWEAVE_FAST_INDEX_URL`, `VITE_CF_BEACON_TOKEN`.

```sh
for k in VITE_CHAIN_ID VITE_RPC_URL VITE_SPONSORSHIP_POLICY_ID VITE_TURBO_UPLOAD_URL \
         VITE_ARWEAVE_GATEWAY_URL VITE_ARWEAVE_FAST_INDEX_URL VITE_RP_ID VITE_RP_NAME VITE_CF_BEACON_TOKEN; do
  v="$(grep "^$k=" apps/web/.env | tail -n 1 | cut -d= -f2-)"
  [ -n "$v" ] && gh variable set "$k" --env production-build --body "$v"
done
```

**5. Development build settings, as `development-build` variables.** These are the same names as step 4, but:
- `VITE_CHAIN_ID=11155420` (OP Sepolia);
- `VITE_RP_ID=dev.cryoshield.app`. The dev build refuses `cryoshield.app`;
- the dev Pimlico policy for `VITE_SPONSORSHIP_POLICY_ID`;
- **no** `VITE_CF_BEACON_TOKEN` (no analytics on dev).

```sh
gh variable set VITE_CHAIN_ID --env development-build --body 11155420
gh variable set VITE_RP_ID --env development-build --body dev.cryoshield.app
gh variable set VITE_RP_NAME --env development-build --body "CryoShield (dev)"
for k in VITE_RPC_URL VITE_TURBO_UPLOAD_URL VITE_ARWEAVE_GATEWAY_URL VITE_ARWEAVE_FAST_INDEX_URL; do
  v="$(grep "^$k=" apps/web/.env | tail -n 1 | cut -d= -f2-)"
  [ -n "$v" ] && gh variable set "$k" --env development-build --body "$v"
done
gh variable set VITE_SPONSORSHIP_POLICY_ID --env development-build    # paste the dev policy id at the prompt
```

**6. Check (names only).** This is a hard gate: it must print `OK`. Run it after step 1, and again at the end.

```sh
.github/rulesets/apply.sh --with-ecc-review --environments && echo OK   # in sync: environments, refs, tag ruleset
gh secret list --env production             # FLY_API_TOKEN only
gh secret list --env development            # FLY_API_TOKEN only
gh secret list --env production-build       # VITE_BUNDLER_URL only
gh secret list --env development-build      # VITE_BUNDLER_URL only
gh variable list --env production-build     # the VITE_* names of step 4
gh variable list --env development-build    # the VITE_* names of step 5, no VITE_CF_BEACON_TOKEN
gh variable list --env production; gh variable list --env development   # nothing
gh secret list --repo prix0007/cryoshield   # must NOT list FLY_API_TOKEN or VITE_BUNDLER_URL (repo-level copies bypass the environments)
```

**7. First deploys.**
- Dev: `gh workflow run deploy-dev.yml --ref main -f force=true`, then check `curl -sI https://dev.cryoshield.app/ | grep -i x-robots-tag`, which must say `noindex, nofollow`.
- Production: `gh release create v0.1.0 --target main --generate-notes`.

**Not configured yet?** Until a build environment has every required variable and its `VITE_BUNDLER_URL` secret, that workflow's `config` job warns ("deploy not configured") and names what is missing. It never prints the values. Nothing after it runs, and the run still **succeeds**. `FLY_API_TOKEN` is only visible to the release job: if it is missing, the release fails at once with "FLY_API_TOKEN is empty: add it to the <environment> environment".

**Optional hardening** (Dependabot security updates, and actions must be pinned to a full commit SHA): `.github/rulesets/apply.sh --with-ecc-review --environments --founder-hardening`, then again with `--apply`.

## Manual deploy

- **Through the pipelines (preferred):**
  - production: `gh workflow run deploy.yml -f tag=vX.Y.Z`;
  - dev: `gh workflow run deploy-dev.yml --ref main -f force=true`.
- **From a laptop** (pipelines disabled, or GitHub down): `apps/web/deploy/deploy.sh` (production) or `DEPLOY_TARGET=development apps/web/deploy/deploy.sh` (dev), with a real `apps/web/.env` for that target and `fly auth login`. See `apps/web/deploy/README.md`.

## Rollback

- **Automatic:** when a deploy or the smoke test fails, the `release` job redeploys the image that was live before (`fly releases --json --image`, validated against the app) and fails the run. The job summary shows the outcome.
- **Production, by release:** `gh workflow run deploy.yml -f tag=<last good vX.Y.Z>`. This is the normal way.
- **By image** (if automatic rollback was impossible, for example on the first deploy):

  ```sh
  fly releases --app cryoshield-web --image          # read-only: pick the last good ImageRef (cryoshield-web-dev for dev)
  fly deploy --app cryoshield-web --config apps/web/fly.toml --image registry.fly.io/cryoshield-web:deployment-<ID>
  curl -s https://cryoshield.app/release.json         # confirms which commit is live again
  ```
- **Pause deploys:** `gh workflow disable deploy-dev.yml` and/or `gh workflow disable deploy.yml`.
- **Stuck machine lease:** if a deploy was cut off mid-update, Fly may keep a machine lease and a rollback can fail with a lease error. Run `fly machine list --app <app>`, then `fly machine leases clear <machine-id> --app <app>`, then roll back by hand as above.
- **Take a site offline:** `fly scale count 0 --app <app>`. Vaults are on-chain, and the desktop recovery tool keeps working.

A rollback restores the previous *image* only. It uses the **new** commit's Fly config. If the bad change was in the config itself, release a fix, or deploy the old image with the old config by hand (`git show <old-commit>:apps/web/fly.toml > /tmp/fly.toml`, then `fly deploy --config /tmp/fly.toml --image ...`). It cannot fix DNS, certificates or Fly app settings.

## Rotating the Fly tokens

Rotate once a year, before `--expiry`, or at once if a token may have leaked. For dev, use `-a cryoshield-web-dev`, `--env development`, and re-run with `gh workflow run deploy-dev.yml --ref main -f force=true`.

```sh
fly tokens list -a cryoshield-web                                   # find the old token's ID
fly tokens create deploy -a cryoshield-web --expiry 8760h --name github-actions-deploy \
  | gh secret set FLY_API_TOKEN --env production                    # replace the secret
fly tokens revoke <old-token-id>                                    # then revoke the old one
gh workflow run deploy.yml -f tag=<current vX.Y.Z>                  # prove the new token works (redeploys the live release)
```

If a Pimlico key changes, re-run step 3 of the setup. If any other value changes, re-run step 4 or 5, then redeploy.

## Before OP Mainnet

Production's chain is changed only through `production-build` variables (`VITE_CHAIN_ID`, `VITE_RPC_URL`, the bundler and policy), plus a deployment record in `contracts/deployments/<chainId>.json`. Before that switch, meet the re-gate criterion in `openspec/changes/split-dev-and-release-deploys/design.md` → Security review:
- dev on a separate registrable domain (threat T1);
- a required reviewer back on `production`;
- agents only through the machine account;
- hardware-key 2FA on the owner's account.

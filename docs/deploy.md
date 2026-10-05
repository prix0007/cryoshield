# Deploy runbook: cryoshield-web-dev.fly.dev and cryoshield.app

There are two targets (OpenSpec change `split-dev-and-release-deploys`, which builds on `add-continuous-deploy` and `gate-production-deploys`):

| | Development | Production |
|---|---|---|
| Site | https://cryoshield-web-dev.fly.dev | https://cryoshield.app |
| Fly app / config | `cryoshield-web-dev` / `apps/web/fly.dev.toml` | `cryoshield-web` / `apps/web/fly.toml` |
| Workflow | `.github/workflows/deploy-dev.yml` | `.github/workflows/deploy.yml` |
| Deploys when | every commit on `main` (push, the 15-minute schedule, dispatch) | the **owner publishes a release** `vX.Y.Z` (or dispatches a redeploy **at** one: `--ref vX.Y.Z`) |
| Human step | none | the owner's release |
| Environments | `development-build` (config), `development` (Fly token) | `production-build` (config), `production` (Fly token) |
| Chain | OP Sepolia | whatever `production-build` says (OP Sepolia today, OP Mainnet later) |
| WebAuthn RP ID | `cryoshield-web-dev.fly.dev` (another registrable domain) | `cryoshield.app` |
| Indexing | `X-Robots-Tag: noindex, nofollow` on every response | indexable |
| Analytics | none (`VITE_CF_BEACON_TOKEN` unset) | Cloudflare beacon, if configured |

The dev site is a testnet sandbox. Never send users there.

**Why dev is on `fly.dev` and not under `cryoshield.app`.** `fly.dev` is on the Public Suffix List, so `cryoshield-web-dev.fly.dev` is its own registrable domain. A web page may use as its WebAuthn RP ID only its own host, or a registrable-domain suffix of it. A page under `cryoshield.app` (for example `dev.cryoshield.app`) could therefore ask a user's key for the PRF output of a **production** vault (`rpId: 'cryoshield.app'`). A page on `cryoshield-web-dev.fly.dev` cannot: the browser refuses.

Dev code ships without a human step, so this boundary is what keeps it away from production vaults. Dev vaults use the dev RP ID and are unrelated to production vaults. `deploy.sh` and `gen-context.mjs` refuse any dev host or dev RP ID under `cryoshield.app`.

**`dev.cryoshield.app` must not serve the app.** Its Fly certificate has been removed, and its DNS records should be deleted (step 0). Until they are gone, any request that still reaches the dev app with that Host header is redirected to `https://cryoshield-web-dev.fly.dev`, never served. The hosting details, DNS and certificates are in [`apps/web/deploy/README.md`](../apps/web/deploy/README.md).

## How it works

Both workflows share one shape. Each stage runs only if the previous one passed:

| Stage | What |
|---|---|
| `detect` | **Dev:** reads `https://cryoshield-web-dev.fly.dev/release.json`. If it already names `main`'s HEAD, or `main` moved on (a newer run owns the deploy), the run stops here. **Production:** runs only if *you* triggered it. It resolves the tag to its commit (`.github/scripts/deploy/release-ref.sh`) and **fails** if the tag is malformed, missing or not reachable from `main`. It also writes the diff from the live commit to the run summary (`release-diff.sh`): a **NOT NEWER THAN LIVE** warning means you are rolling back, and **TOKEN-PATH CHANGED** lists files that change what runs with the Fly token. |
| `config` | Checks that the build environment has every required variable (names only). If not, it warns and skips the rest, and the run still succeeds. |
| `test` | The **full** `ci.yml` (`full: true`) on the exact commit: every area job, no path filters. Production always runs at the release tag, so that commit is the tag's (a rollback runs the old tag's own CI), not `main`'s HEAD. |
| `build` | In the build environment, **without the Fly token**. It writes `apps/web/.env` from the environment, then runs `DEPLOY_TARGET=<target> apps/web/deploy/deploy.sh --build-only`. That applies every guard: clean tree, RP ID == the target's host (and never the production RP ID on dev), two identical builds, bundle checks. The output is uploaded as an artifact: the site, Caddyfile (with the noindex header for dev only), release manifest and `release.json`. |
| `release` | The only job in the Fly-token environment. It runs **no node, pnpm or build code** (enforced by `workflow-policy.mjs`). It verifies the artifact against its manifest and installs pinned, checksummed flyctl. Then, **immediately before `fly deploy`**, it re-checks the commit. On dev, if the commit is no longer `main`'s HEAD, the run deploys nothing and ends green with a "Superseded" notice. On production, if the tag no longer points at the commit or the commit is no longer on `main`, the run fails. Otherwise it records the live image, runs `fly deploy`, and smoke-tests the site. The smoke test covers the pages, the security headers, the registry and donation addresses and `/release.json`; on dev it also requires the noindex header, and on production it requires its *absence*. On any failure, or a cancellation after `fly deploy` started, it **rolls back automatically** to the previous image and fails the run. |

**Concurrency.**
- Dev runs share `deploy-dev-<sha>` per commit, and the dev release job holds `deploy-development`. A newer commit's pending release replaces an older pending one.
- Production has **no** workflow-level group: one would be claimed before the owner gate, so a stranger's run (skipped at once) could hold it, or replace your pending run. `detect`, `config` and `build` use per-run groups (`github.run_id`) that no other run shares. Only the release job holds a shared group, `deploy-production`, and only runs you started reach it.
- Neither is ever cancelled mid-deploy, and dev and production never cancel or wait for each other.

Neither pipeline runs on pull requests, and `workflow-policy.mjs` enforces that in CI.

**Which commit is live?** `curl -s https://cryoshield-web-dev.fly.dev/release.json` and `curl -s https://cryoshield.app/release.json` return the commit, the `treeHash` and the public config (chain, RP ID, registry).

## Releasing to production [owner]

Only the repository owner can ship to production. Three independent layers enforce it:
1. **The tag ruleset `release-tags`** (`.github/rulesets/release-tags.json`): only admins may create, move or delete `v*` tags.
2. **The workflow:** the production run starts only when you trigger it (`github.triggering_actor == github.repository_owner`). This also covers a release published on an existing tag, a dispatch, or a re-run by anyone else.
   - **Caveat:** `repository_owner` is the account that owns the repository, today your user `prix0007`. If the repository is ever transferred to an **organization**, it becomes the organization's login, which no person's login equals. Production deploys then fail closed: `detect` is always skipped. Replace that gate (for example with an admin-team membership check) as part of the transfer.
3. **The environments:** `production` and `production-build` accept **only `v*` tags**, with no branch policy at all, not even `main`. No workflow on any branch can obtain the production token or build config. Because only admins can create `v*` tags, **the only path to production secrets is a tag you created.**

The agents' machine account (Write role) therefore cannot ship to production. Agents never create tags or releases.

**Cut a release** from `main`:

```sh
git fetch origin && git log --oneline origin/main -5          # what you are about to ship
curl -s https://cryoshield-web-dev.fly.dev/release.json               # dev already runs main's HEAD?
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
gh workflow run deploy.yml --ref v1.1.0        # runs AT the tag: full CI on v1.1.0's commit, build, deploy, smoke
```

This works for any `v*` tag on `main`. The run uses the tag's own workflow and CI, the ones that release passed. A dispatch from a branch (`main` included) is skipped, and could not reach the production environments anyway.

A release whose deploy or smoke test fails rolls back by itself and the run fails. Fix forward with a new release, or redeploy a good tag as above.

## Development deploys

There is nothing to do. Every commit on `main` reaches https://cryoshield-web-dev.fly.dev within about 15 minutes: on push for human merges, on the 15-minute schedule for auto-merges (merges made by the workflow token start no push workflow).
- A commit whose dev deploy or smoke test failed is **not retried** by the schedule. Fix forward, or `gh workflow run deploy-dev.yml --ref main -f force=true`.
- Pause dev deploys: `gh workflow disable deploy-dev.yml`. Resume: `gh workflow enable deploy-dev.yml`.

## First-time setup [owner]

Run these once. None of them prints a secret value.

> **Order matters.** The branch/tag policies (step 1) keep the secrets away from any other branch or tag: a workflow pushed on a feature branch could otherwise ask for an environment. Create them, run the step 6 check, and only then set secrets.

**0. The dev app, and retiring `dev.cryoshield.app`.**
- **Already done** (2026-10-05): the Fly app `cryoshield-web-dev` exists (org `cryoshield`, region `sin`). It serves on its `fly.dev` name with Fly's own certificate, so it needs **no** DNS record and **no** `fly certs add`.
- **Already done:** the Fly certificate for `dev.cryoshield.app` has been removed.
- **To do before the first production release:** delete the `dev` A/AAAA (or CNAME) records for `dev.cryoshield.app` at the DNS provider. A dangling record pointing at Fly could otherwise be claimed by someone else.

To check:

```sh
fly apps list --org cryoshield | grep cryoshield-web-dev
fly certs list --app cryoshield-web-dev                  # must NOT list dev.cryoshield.app
dig +short dev.cryoshield.app A; dig +short dev.cryoshield.app AAAA   # must print nothing once the records are gone
curl -sI https://cryoshield-web-dev.fly.dev/ | grep -i x-robots-tag     # noindex, nofollow (after the first dev deploy)
```

If you ever need to recreate the app: `fly apps create cryoshield-web-dev --org cryoshield`. Never add a custom domain under `cryoshield.app` to it.

**1. Environments and the tag ruleset.** Four environments, with no reviewers and no admin bypass:
- `production` and `production-build`, deployable **only from `v*` tags** (no branch);
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
- use a **separate dev key**, restricted to `https://cryoshield-web-dev.fly.dev`, with its own small sponsorship cap.

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
- `VITE_RP_ID=cryoshield-web-dev.fly.dev`. The dev build refuses `cryoshield.app` and any subdomain of it;
- the dev Pimlico policy for `VITE_SPONSORSHIP_POLICY_ID`;
- **no** `VITE_CF_BEACON_TOKEN` (no analytics on dev).

```sh
gh variable set VITE_CHAIN_ID --env development-build --body 11155420
gh variable set VITE_RP_ID --env development-build --body cryoshield-web-dev.fly.dev
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
- Dev: `gh workflow run deploy-dev.yml --ref main -f force=true`, then check `curl -sI https://cryoshield-web-dev.fly.dev/ | grep -i x-robots-tag`, which must say `noindex, nofollow`.
- Production: `gh release create v0.1.0 --target main --generate-notes`.

**Not configured yet?** Until a build environment has every required variable and its `VITE_BUNDLER_URL` secret, that workflow's `config` job reports "deploy not configured" and names what is missing (never the values). Nothing after it runs.
- **Dev:** it is a warning, and the run **succeeds**, so `main` is not marked red.
- **Production:** a release or dispatch is deliberate, so the run **fails**. Configure, then re-run `gh workflow run deploy.yml --ref vX.Y.Z`. `FLY_API_TOKEN` is only visible to the release job: if it is missing, the release fails at once with "FLY_API_TOKEN is empty: add it to the <environment> environment".

**Optional hardening** (Dependabot security updates, and actions must be pinned to a full commit SHA): `.github/rulesets/apply.sh --with-ecc-review --environments --founder-hardening`, then again with `--apply`.

## Manual deploy

- **Through the pipelines (preferred):**
  - production: `gh workflow run deploy.yml --ref vX.Y.Z`;
  - dev: `gh workflow run deploy-dev.yml --ref main -f force=true`.
- **From a laptop** (pipelines disabled, or GitHub down): `apps/web/deploy/deploy.sh` (production) or `DEPLOY_TARGET=development apps/web/deploy/deploy.sh` (dev), with a real `apps/web/.env` for that target and `fly auth login`. See `apps/web/deploy/README.md`.

## Rollback

- **Automatic:** when a deploy or the smoke test fails, the `release` job redeploys the image that was live before (`fly releases --json --image`, validated against the app) and fails the run. The job summary shows the outcome.
- **Production, by release:** `gh workflow run deploy.yml --ref <last good vX.Y.Z>`. This is the normal way.
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
gh workflow run deploy.yml --ref <current vX.Y.Z>                   # prove the new token works (redeploys the live release)
```

If a Pimlico key changes, re-run step 3 of the setup. If any other value changes, re-run step 4 or 5, then redeploy.

## Before OP Mainnet

Production's chain is changed only through `production-build` variables (`VITE_CHAIN_ID`, `VITE_RPC_URL`, the bundler and policy), plus a deployment record in `contracts/deployments/<chainId>.json`. Before that switch, meet the re-gate criterion in `openspec/changes/split-dev-and-release-deploys/design.md` → Security review:
- a required reviewer back on `production`;
- agents only through the machine account;
- hardware-key 2FA on the owner's account.

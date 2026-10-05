# Design

## Context

After `gate-production-deploys`, `.github/workflows/deploy.yml` deploys every commit on `main` to `cryoshield-web` (https://cryoshield.app), once the owner approves it in the `production` environment. It runs on push, on a 15-minute schedule (auto-merges start no push workflow) and on `workflow_dispatch`.

On 2026-10-05 the founder decided that a merge should not wait for an approval (PR #32, which failed ECC review and is folded into this change). Instead:
- `main` goes to a development site on OP Sepolia;
- production happens only when a release is published.

The relevant pieces today:
- `production` (Fly token) and `production-build` (`VITE_*`, `VITE_BUNDLER_URL`), both with a `main`-only branch policy.
- The release job holds the token and runs no build tooling. Its run steps are digest-pinned in `privileged-run-steps.json`.
- The `supersede` job, the only `actions: write` job in the repository. It cancels older runs *waiting for approval*.
- `deploy.sh` with `DEPLOY_HOST` (default `cryoshield.app`). The guards "RP ID == host" and "bundle RP ID == host" run in `verify-build --expect-host`.

## Goals / Non-Goals

**Goals:**
- `main` deploys to `https://cryoshield-web-dev.fly.dev` (Fly app `cryoshield-web-dev`) automatically.
- Production deploys only from a published `v*` release, or from an owner-dispatched redeploy of a `v*` tag.
- Only the owner can cause a production deploy.
- Code that reaches dev without a human step can never request PRF outputs for production vaults.
- Each Fly token is reachable only from its own workflow's release job, and the policy check proves it.
- No chain is hardcoded: production keeps using whatever `production-build` says.

**Non-Goals:**
- A per-release reviewer on `production`. The owner's release is the human step; a reviewer is re-added before mainnet (see Security review).
- A dev contract deployment.
- Automatic release creation.
- Mainnet.

## Decisions

### 1. Two workflow files: `deploy.yml` (production) and `deploy-dev.yml` (development)

There is one file per target. The policy then has one profile per file, and token isolation becomes a per-file statement: "the only environments `deploy.yml` may name are `production` and `production-build`; the only ones `deploy-dev.yml` may name are `development` and `development-build`". These are literal lists, with no computed targets, and the triggers differ completely.

*Alternative:* one workflow whose first job resolves the target. Rejected because environment names must be literal (review M3). One file would therefore hold jobs for both environments behind `if:` conditions, and proving that a push to `main` can never reach the `production` job would depend on condition logic instead of on which file the job is in.

The file name `deploy.yml` stays with production, so the rollback command `gh workflow run deploy.yml -f tag=vX.Y.Z` reads naturally.

### 2. Development: `deploy-dev.yml`

The shape is today's pipeline: `detect → config → test (full ci.yml) → build → release`.
- **Triggers:** push to `main`, the 15-minute schedule, and `workflow_dispatch` (`force`). The first job requires `github.ref == 'refs/heads/main'`.
- **Environments:**
  - `development-build`: the `VITE_*` vars and the `VITE_BUNDLER_URL` secret; `main` only; no reviewer.
  - `development`: only `FLY_API_TOKEN`, an app-scoped deploy token for `cryoshield-web-dev`; `main` only; no reviewer.
- **Concurrency:**
  - workflow: `deploy-dev-${{ github.sha }}`, never cancelled;
  - release job: `deploy-development`, never cancelled.

  Neither group can collide with production's groups.
- **Head re-check, right before `fly deploy`** (ECC L1). "The commit is still `main`'s HEAD" is checked in the step immediately before `deploy`. If `main` moved on, the step writes a `Superseded` notice and `current=false`. `deploy`, the summary and `smoke` then do not run, and the run ends green: being superseded is normal, not a failure, and a newer run deploys `main`.
- **No `supersede`.** It cancelled runs *waiting for an approval*. Without a reviewer a run never waits, so it was dead code holding the repository's only `actions: write`. Superseding still happens in two ways:
  - GitHub keeps at most one *pending* job per concurrency group, and cancels the older pending one when a newer one queues;
  - `detect` and the release-time head check skip commits that are no longer `main`'s HEAD.

  The script, its test, its stub and the policy exception are removed.
- **Fly config:** `apps/web/fly.dev.toml`: app `cryoshield-web-dev`, region `sin`, `auto_stop_machines = "suspend"`, `min_machines_running = 0`, and the same build, VM and health check as production. It has no custom domain: the app serves on its own `fly.dev` name.
- **Unconfigured:** a missing `development-build` value warns and skips, and the run stays green (`deploy-skip-when-unconfigured`).

### 3. Production: `deploy.yml`

- **Triggers:**
  - `release: types: [published]`;
  - `workflow_dispatch` with a required `tag` input.

  There is no `push`, no `schedule` and no `pull_request`. The policy also requires `types` to be exactly `[published]`, so `created` and `edited` (which Write users can trigger) are excluded.
- **First-job gate** (`detect`), as two top-level conjuncts the policy requires verbatim:
  - `github.triggering_actor == github.repository_owner`. Only the owner can start, or *re-run*, a production deploy. `triggering_actor` is the user who re-ran a run, so an agent re-running the owner's run is refused too.
    - *Org-owner caveat (ECC L3):* `github.repository_owner` is the **account that owns the repository**. Today that is the user `prix0007`. If the repository moves to an organization, `repository_owner` becomes the organization's login, which no user's `triggering_actor` can ever equal. Production deploys then **fail closed** (the first job is always skipped) until this conjunct is replaced, for example by a check of membership in an admin team through the API. Moving the repository must include that change.
  - `((github.event_name == 'release' && startsWith(github.ref, 'refs/tags/v')) || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'))`. Dispatches from any branch other than `main` are skipped, because a branch could carry a modified workflow file.
- **`release-ref.sh`** (new) resolves and checks the tag through the API, before any build:
  - The tag must match `^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z][0-9A-Za-z.-]*)?$`. This is stricter than `v*`, so names stay sane in logs and concurrency groups.
  - `GET git/ref/tags/<tag>` must answer exactly `refs/tags/<tag>`. Annotated tags are followed through `git/tags/<sha>`, for at most 5 hops, to a commit. A branch called `v1.2.3` can never shadow the tag, because the ref namespace is explicit.
  - On a `release` event, the resolved commit must equal `github.sha` (`EXPECT_SHA`).
  - `GET compare/<commit>...<main HEAD>` must be `identical` or `ahead`, which means the commit is an ancestor of, or equal to, `main`'s HEAD. Otherwise the run fails ("not reachable from main"), before the config, CI or build jobs.
  - Outputs: `deploy=true`, `sha`, `tag`.
- **Config:** a release or dispatch is deliberate, so a missing `production-build` value **fails** the run (`MISSING_IS_ERROR=true`, ECC L2) instead of skipping green.
- **Full CI on the tagged commit.**
  - On a `release` event, `github.sha` *is* the tagged commit. On a dispatch, it is `main`'s HEAD.
  - So `ci.yml`'s `workflow_call` gains an optional `ref` input that every area-job checkout uses (empty means the default, as before). The production workflow passes the resolved 40-hex commit, never the tag name.
  - On a dispatch, the CI *definition* comes from `main` while the code is the tag's. This is acceptable for redeploys and rollbacks: today's CI rules are applied to the older code. If today's CI can no longer run on an old tag, cut a fix-forward release instead.
- **Build** in `production-build` with `DEPLOY_TARGET=production`, at the resolved commit.
- **Release** in `production` (no reviewer), concurrency `deploy-production`, never cancelled.
  - The old "still `main`'s HEAD" check is wrong for releases, because `main` normally moves on after a tag.
  - It is replaced by a step with id `tag-check`, **immediately before** `deploy`. It runs `release-ref.sh` again with `EXPECT_SHA` set to the built commit: the tag must still point at that commit, and the commit must still be reachable from `main`. If not, the run fails (a moved tag is never "superseded").
- **Workflow concurrency:** `deploy-release-${{ github.event.release.tag_name || inputs.tag }}`, never cancelled.
- **`release-diff.sh`** keeps running for production, as an informational `detect` step. It shows the diff from the live commit and warns "NOT NEWER THAN LIVE" on a rollback. It never blocks.
- **Chain:** unchanged mechanism. `production-build`'s `VITE_CHAIN_ID` and RPC choose it, and the smoke test reads the chain from the verified manifest. Moving to OP Mainnet means changing environment variables only (plus the deployment record), with no workflow edit.
- Production has no `detect`-style "already live" skip: a published release or an explicit dispatch is always a deliberate deploy.

### 4. Owner-only production

There are three independent layers:
1. **Tag ruleset** `release-tags` (`.github/rulesets/release-tags.json`): target `tag`, `refs/tags/v*`, rules `creation`, `update` and `deletion`, bypass actor `RepositoryRole` 5 (admin) only. The agents' machine account (Write) can create no `v*` tag. `gh release create` with a new tag creates the tag, so it is blocked for them too. `apply.sh` syncs the ruleset by name and target, like `main`.
2. **Workflow gate:** `github.triggering_actor == github.repository_owner` on the first job (decision 3, including the org-owner caveat). This covers what the ruleset cannot: Write users can publish a release on an *existing* owner-created tag, and can run `workflow_dispatch`.
3. **Environment branch policies:** `production` and `production-build` allow `main` (dispatch) and `v*` tags (release event). A workflow on any other branch or tag gets no secrets. The dev environments allow `main` only.

`environments.json` gains a `tags` list beside `branches`. `apply.sh` reconciles it as `tag:` deployment policies, and its existing "delete every other policy" logic covers both types.

### 5. Development host and RP ID: another registrable domain; keeping dev out of search

- **Host and RP ID: `cryoshield-web-dev.fly.dev`** (overwatcher decision on T1, 2026-10-05). `fly.dev` is on the Public Suffix List, so `cryoshield-web-dev.fly.dev` is its own registrable domain, unrelated to `cryoshield.app`.
  - WebAuthn lets a page use as its RP ID only its own host or a registrable-domain suffix of it. `cryoshield.app` is neither for this origin, so a dev page **cannot** call `navigator.credentials.get` with `rpId: 'cryoshield.app'`. The browser rejects it with a `SecurityError`.
  - Code that auto-deploys to dev, honest or not, therefore cannot request PRF outputs for production vaults.
  - Dev vaults are bound to `cryoshield-web-dev.fly.dev` and are unrelated to production vaults.
- **Guards:**
  - `deploy.sh` maps `DEPLOY_TARGET=development` to the host `cryoshield-web-dev.fly.dev`, so the existing guards hold for the dev host: the `.env` `VITE_RP_ID` == host, and the bundle RP ID == host.
  - `deploy.sh` refuses a non-production host, or a non-production RP ID, that is `cryoshield.app` or any subdomain of it.
  - `gen-context.mjs` accepts exactly two host/noindex pairs (`parseArgs({ strict: true })`, ECC M5): `cryoshield.app` without noindex, and `cryoshield-web-dev.fly.dev` with noindex. A subdomain of `cryoshield.app` is refused by name.
- **`dev.cryoshield.app` is retired.** It must not serve the app, because a page there could assert `rpId: 'cryoshield.app'`. Its Fly certificate is removed; its DNS records must be deleted (`docs/deploy.md`). Requests to any non-canonical host, that name included, get a 301 to the dev host.
- **Noindex, by header only.** `gen-context.mjs --noindex` adds `X-Robots-Tag "noindex, nofollow"` to every response, error responses included. Nothing else changes: the CSP, the other headers and the site files stay the same, so the tree hash does too.
  - There is deliberately **no** dev `robots.txt`. A static disallow-all file in `public/` would also ship to production. Another change owns production's `robots.txt` and sitemap (SEO coordination, 2026-10-05). A crawler must also be able to *fetch* a page to see its noindex header.
  - `smoke.sh` takes `EXPECT_NOINDEX`:
    - `true`: every page must carry exactly `noindex, nofollow`;
    - `false` (production): no page may carry a noindex header, so a dev Caddyfile shipped to production by mistake fails the smoke test and rolls back.
- **Analytics.** `deploy-dev.yml` never passes `VITE_CF_BEACON_TOKEN` (the policy forbids the name in that file, ECC M2). `write-env.sh` treats it as optional, and `verify-build --real-env` accepts a build without the beacon.

### 6. Script parametrisation

- `deploy.sh`: `DEPLOY_TARGET` (`production` by default) selects:
  - production: `cryoshield.app`, `cryoshield-web`, `fly.toml`;
  - development: `cryoshield-web-dev.fly.dev`, `cryoshield-web-dev`, `fly.dev.toml`, noindex.

  `DEPLOY_HOST` is refused, so a stale invocation cannot silently target production.
- `previous-image.sh` and `rollback.sh` take `APP` and `CONFIG` from the workflow's `FLY_APP` and `FLY_CONFIG`. `previous-image.sh`'s "not configured" message names the environment (`DEPLOY_ENVIRONMENT`).
- `check-config.sh` names the build environment (`BUILD_ENVIRONMENT`) and the workflow to re-run (`WORKFLOW`). With `MISSING_IS_ERROR=true` it fails instead of skipping.
- `write-env.sh` names the build environment in every message (`BUILD_ENVIRONMENT`, ECC L6).

### 7. Workflow policy

`workflow-policy.mjs` replaces the single `deploy.yml` rule set with `DEPLOY_PROFILES`, keyed by file. Each profile holds:
- the triggers;
- the push branches, or the release types;
- the exact workflow concurrency group;
- the required first-job conjuncts;
- the release environment and build environment;
- the release job's concurrency group;
- the re-check step (id and script);
- the deploy step's required condition;
- the names the file must never reference.

For each deploy file, the policy enforces:
- only its two environments;
- `FLY_API_TOKEN` only in the step env of steps `deploy` and `rollback` in its release-environment job;
- `VITE_BUNDLER_URL` only in `web-env`, and as a presence check in `config`, in its build-environment job;
- one release job;
- the re-check step immediately before `deploy`, running unconditionally;
- no write scopes at all (the `supersede` exception is gone);
- **no `always()`, `failure()` or `cancelled()` in any job-level condition** (ECC M3). A status function overrides the implicit `success()` of a job's `needs`, so `always() && needs.detect.outputs.deploy == 'true'` would release after a failed test or build. Step-level `failure() || cancelled()` stays allowed for rollback and fail-loudly;
- every job that needs `config` carries the conjunct `needs.config.outputs.configured == 'true'`;
- the digest pinning of every run step in token jobs, per file;
- no build tooling or third-party actions in token jobs;
- for `deploy-dev.yml`: no reference to `VITE_CF_BEACON_TOKEN`.

Every other workflow may name none of the four environments and may not reference `FLY_API_TOKEN`. The zizmor `self-repository` ignore is allowed once per deploy file, pinned to that file's reusable-CI call line.

## Threats

- **T1. Dev code requesting production PRF outputs: RESOLVED.** Dev is served from `cryoshield-web-dev.fly.dev`, another registrable domain (decision 5). The browser refuses `rpId: 'cryoshield.app'` from that origin, whatever the dev code does. `deploy.sh` and `gen-context.mjs` refuse any dev host under `cryoshield.app`. `dev.cryoshield.app` is retired (its certificate is removed and its DNS records are to be deleted), and a request with that Host header is redirected to the dev host, never served.
- **T2. An agent ships to production.** Blocked by layers 1–3 of decision 4. Write role can push branches, open PRs and dispatch workflows, but:
  - it cannot create, move or delete `v*` tags;
  - a release it publishes on an existing tag, a dispatch, or a re-run it triggers is skipped by the owner gate;
  - a workflow it changes on a branch gets no production secrets.

  Residual: a change merged to `main` reaches production the next time the owner publishes a release from `main`. The owner reviews the generated notes and `release-diff.sh`'s summary, which is the human step CI-C1 asked for.
- **T3. Token confusion.** Both environments hold a secret named `FLY_API_TOKEN`, but GitHub resolves environment secrets per job environment. The policy pins:
  - `deploy.yml`'s token steps to `production`;
  - `deploy-dev.yml`'s token steps to `development`.

  Each token is an app-scoped Fly deploy token. A dev token in the wrong environment could only deploy the dev app.
- **T4. A tag moved between build and release.** The release job re-resolves the tag right before deploying, and requires the same commit (`tag-check`). Moving a tag needs admin rights anyway (ruleset).
- **T5. An unreachable or forked commit.** A tag on a commit that is not in `main`'s history (for example a branch the owner tagged by mistake) fails `release-ref.sh` before any build, and again at release time.
- **T6. Dev bundler key abuse.** Dev is public, so its bundler URL is too. `development-build` holds a separate Pimlico key, restricted to the origin `https://cryoshield-web-dev.fly.dev`, with its own small sponsorship cap (`docs/deploy.md`).
- **T7. Search exposure of a test site.** The noindex header is smoke-tested on every dev deploy. Production is smoke-tested for the *absence* of the header.
- **T8. A job releasing after a failed stage.** A job-level `always()` (or `failure()`/`cancelled()`) would bypass the implicit success of `needs`. The policy refuses it in both deploy workflows (ECC M3).

## Security review

This is the review that PR #32 lacked; that PR is folded into this change. The audit report's CI-C1 row links here.

### Threat table

| # | Threat | Before (every merge to production) | Now | Compensating controls | Residual / decision |
|---|---|---|---|---|---|
| S1 | **Auto-shipped dev code.** Code merged by an agent (PR → LLM review → auto-merge) goes live on `cryoshield-web-dev.fly.dev` with no human step. | It went to **production** the same way (after PR #32). | Dev only. Production needs an owner release. | <ul><li>PR gates: `ci-ok`, ECC review, gitleaks, osv, the OpenSpec gate.</li><li>The full CI is re-run on the merge commit.</li><li>Dev is on another registrable domain with its own RP ID, so it cannot reach production credentials (T1 resolved).</li><li>Its own Fly app and app-scoped token, and its own Pimlico key with a small cap.</li><li>noindex; no analytics.</li></ul> | **Accepted for dev.** Worst case: a broken or defaced testnet site, and dev-only vaults. |
| S2 | **Fly-token-path scripts run with a token and no human step.** These are `.github/scripts/deploy/*`, `apps/web/fly.toml`, `apps/web/fly.dev.toml`, `apps/web/.dockerignore` and `apps/web/deploy/Dockerfile`, all from the deployed commit. | They ran with the *production* token on every merge. | On dev they run with the **dev** token only. On production they run only for an owner-cut tag, so production token use is human-gated. | <ul><li>Release-job run steps are digest-pinned (`privileged-run-steps.json`).</li><li>No build tooling or third-party actions in token jobs.</li><li>`release-diff.sh` flags TOKEN-PATH files in the production run summary.</li><li>The dev token is an **app-scoped deploy token** (`fly tokens create deploy -a cryoshield-web-dev`): it can deploy, roll back and read releases of `cryoshield-web-dev` only, and cannot touch `cryoshield-web` or the org.</li></ul> | **Accepted for dev**: worst case is a defaced or broken dev site. |
| S3 | **Production token gated only by owner-only `v*` tags.** | A merge was enough. | It needs a published `v*` release, or a dispatch, by the owner. | <ul><li>Tag ruleset (admin-only bypass).</li><li>The `triggering_actor == repository_owner` gate (fails closed if the repository moves to an organization).</li><li>`production` accepts only `main` and `v*` refs.</li><li>The tag must be on `main`, re-checked immediately before deploy.</li></ul> | The owner's GitHub account is now the production key. It must keep 2FA (hardware key) and never share admin. |
| S4 | **Cross-target token use** (dev code getting the production token, or the reverse). | n/a | Blocked. | Per-file policy profiles: each workflow names only its own environments; each environment holds only its own app's token; both are proved by tests. | None known. |
| T1 | **Dev page asserting production credentials** (`rpId: 'cryoshield.app'`). | Not applicable (no dev site). | **Resolved**: dev is on `cryoshield-web-dev.fly.dev`, another registrable domain. | The browser enforces the RP ID; `deploy.sh` and `gen-context` refuse dev hosts under `cryoshield.app`; `dev.cryoshield.app` is retired. | None. |

### Acceptance and the mainnet re-gate criterion

- **Development:** S1 and S2 are accepted by the founder's request ("main merge triggers development deployment"). Dev holds no production credential and cannot assert the production RP ID.
- **Production:** the owner-published release is the human step that CI-C1 asked for. No required reviewer is added on top.
- **Re-gate before OP Mainnet.** Before `production-build` points at OP Mainnet, **all** of the following must hold:
  1. `production` regains a required reviewer (`"required_reviewers": ["@owner"]`, then `apply.sh --environments --apply`), so a mainnet deploy needs both a release and an approval.
  2. CI-H1 is closed: agents use the machine account only (`docs/agent-account.md`).
  3. The owner's account has hardware-key 2FA.
  4. `dev.cryoshield.app` has no DNS record, and nothing under `cryoshield.app` other than the production site serves the app.

  Record the check in a `docs/reviews/` entry.

### Review notes

- **Token isolation:**
  - `deploy.yml`'s only token job is `release`, in `production`;
  - `deploy-dev.yml`'s only token job is `release`, in `development`;
  - both are pinned by digest, run no build tooling, and use only `actions/checkout` and `actions/download-artifact`;
  - the policy tests cover cross-environment use (a dev job naming `production`, a production job naming `development`) and token use in any other workflow.
- **Write scopes:** none remain in the deploy workflows. The `supersede` job, which only ever cancelled runs *waiting for an approval* and was dead without one, and its `actions: write` exception were removed.
- **Triggers:** neither workflow can run on `pull_request`; `deploy.yml` has no push or schedule; `release` is limited to `published`.
- **Job conditions:** no status functions at job level; config-dependent jobs require `configured == 'true'` (ECC M3).
- **Owner gate:** the policy requires it as a top-level conjunct, alongside the tag ruleset (admin-only bypass) and the tag-aware environment policies. Org-owner caveat documented.
- **`apply.sh`:**
  - looks up the owner only when an environment names `@owner`;
  - removes a live reviewer when the committed list is empty;
  - each environment drift test now differs in exactly one property (PR #32 review).

The review is done in task 6 and recorded above.

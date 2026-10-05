# Design

## Context

After `remove-production-approval-gate`, `.github/workflows/deploy.yml` deploys every commit on `main` to `cryoshield-web` (https://cryoshield.app). It runs on push, a 15-minute schedule (auto-merges start no push workflow) and `workflow_dispatch`, and it has no human step. The founder now wants:
- `main` to go to a development site on OP Sepolia;
- production to happen only when a release is published.

The relevant pieces today:
- `production` (Fly token) and `production-build` (`VITE_*`, `VITE_BUNDLER_URL`), both with a `main`-only branch policy and no reviewer.
- The release job holds the token and runs no build tooling. Its run steps are digest-pinned in `privileged-run-steps.json`.
- The `supersede` job, the only `actions: write` job in the repository. It cancels older runs *waiting for approval*.
- `deploy.sh` with `DEPLOY_HOST` (default `cryoshield.app`). The guards "RP ID == host" and "bundle RP ID == host" run in `verify-build --expect-host`.

## Goals / Non-Goals

**Goals:**
- `main` deploys to `https://dev.cryoshield.app` (`cryoshield-web-dev`) automatically.
- Production deploys only from a published `v*` release, or an owner-dispatched redeploy of a `v*` tag.
- Only the owner can cause a production deploy.
- Each Fly token is reachable only from its own workflow's release job, and that is provable by the policy check.
- No chain is hardcoded: production keeps using whatever `production-build` says.

**Non-Goals:**
- A reviewer on `production`.
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
  - `development`: only `FLY_API_TOKEN`, a deploy token for `cryoshield-web-dev`; `main` only; no reviewer.
- **Concurrency:**
  - workflow: `deploy-dev-${{ github.sha }}`, never cancelled;
  - release job: `deploy-development`, never cancelled.

  Neither group can collide with production's groups (decision 4).
- **Head re-check:** "the commit is still `main`'s HEAD" stays for dev. It is correct there: `main` is the source of truth for the dev site.
- **No `supersede`.** It cancelled runs *waiting for an approval*. Without a reviewer a run never waits, so it was dead code holding the repository's only `actions: write`. Superseding still happens in two ways:
  - GitHub keeps at most one *pending* job per concurrency group and cancels the older pending one when a newer one queues;
  - `detect` and the release-time head check skip or refuse commits that are no longer `main`'s HEAD.

  The script, its test, its stub and the policy exception are removed.
- **Fly config:** `apps/web/fly.dev.toml`: app `cryoshield-web-dev`, region `sin`, `auto_stop_machines = "suspend"`, `min_machines_running = 0`, the same build and health check as production.

### 3. Production: `deploy.yml`

- **Triggers:**
  - `release: types: [published]`;
  - `workflow_dispatch` with a required `tag` input.

  There is no `push`, no `schedule` and no `pull_request`. The policy also requires `types` to be exactly `[published]`, so `created` and `edited` (which Write users can trigger) are excluded.
- **First-job gate** (`detect`), as two top-level conjuncts the policy requires verbatim:
  - `github.triggering_actor == github.repository_owner`. Only the owner can start, or *re-run*, a production deploy. `triggering_actor` is the user who re-ran a run, so an agent re-running the owner's run is refused too.
  - `((github.event_name == 'release' && startsWith(github.ref, 'refs/tags/v')) || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'))`. Dispatches from any branch other than `main` are skipped, because a branch could carry a modified workflow file.
- **`release-ref.sh`** (new) resolves and checks the tag through the API, before any build:
  - The tag must match `^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z][0-9A-Za-z.-]*)?$`. This is stricter than `v*`, so names stay sane in logs and concurrency groups.
  - `GET git/ref/tags/<tag>` must answer exactly `refs/tags/<tag>`. Annotated tags are followed through `git/tags/<sha>`, for at most 5 hops, to a commit. A branch called `v1.2.3` can never shadow the tag, because the ref namespace is explicit.
  - On a `release` event, the resolved commit must equal `github.sha` (`EXPECT_SHA`).
  - `GET compare/<commit>...<main HEAD>` must be `identical` or `ahead`, which means the commit is an ancestor of, or equal to, `main`'s HEAD. Otherwise the run fails ("not reachable from main"), before the config, CI or build jobs.
  - Outputs: `deploy=true`, `sha`, `tag`.
- **Full CI on the tagged commit.** On a `release` event, `github.sha` *is* the tagged commit. On a dispatch it is `main`'s HEAD. So `ci.yml`'s `workflow_call` gains an optional `ref` input that every area-job checkout uses (empty means the default, as before), and the production workflow passes the resolved 40-hex commit, never the tag name. On a dispatch, the CI *definition* comes from `main` while the code is the tag's. This is acceptable for redeploys and rollbacks: today's CI rules are applied to the older code. If today's CI can no longer run on an old tag, cut a fix-forward release instead.
- **Build** in `production-build` with `DEPLOY_TARGET=production`, at the resolved commit.
- **Release** in `production` (no reviewer), concurrency `deploy-production`, never cancelled. The old "still `main`'s HEAD" check is wrong for releases, because `main` normally moves on after a tag. It is replaced by a step with id `tag-check` that runs `release-ref.sh` again, with `EXPECT_SHA` set to the built commit, right before `fly deploy`. The tag must still point at that commit, and the commit must still be reachable from `main`.
- **Workflow concurrency:** `deploy-release-${{ github.event.release.tag_name || inputs.tag }}`, never cancelled.
- **`release-diff.sh`** keeps running for production, as an informational `detect` step. It shows the diff from the live commit and warns "NOT NEWER THAN LIVE" on a rollback. It never blocks.
- **Chain:** unchanged mechanism. `production-build`'s `VITE_CHAIN_ID` and RPC choose it, and the smoke test reads the chain from the verified manifest. Moving to OP Mainnet means changing environment variables only (plus the deployment record), with no workflow edit.
- Production has no `detect`-style "already live" skip: a published release or an explicit dispatch is always a deliberate deploy.

### 4. Owner-only production

There are three independent layers:
1. **Tag ruleset** `release-tags` (`.github/rulesets/release-tags.json`): target `tag`, `refs/tags/v*`, rules `creation`, `update` and `deletion`, bypass actor `RepositoryRole` 5 (admin) only. The agents' machine account (Write) can create no `v*` tag. `gh release create` with a new tag creates the tag, so it is blocked for them too. `apply.sh` syncs it by name and target, like `main`.
2. **Workflow gate:** `github.triggering_actor == github.repository_owner` on the first job (decision 3). This covers what the ruleset cannot: Write users can publish a release on an *existing* owner-created tag, and can run `workflow_dispatch`.
3. **Environment branch policies:** `production` and `production-build` allow `main` (dispatch) and `v*` tags (release event). A workflow on any other branch or tag gets no secrets. The dev environments allow `main` only.

`environments.json` gains a `tags` list beside `branches`. `apply.sh` reconciles it as `tag:` deployment policies, and its existing "delete every other policy" logic covers both types.

### 5. Development RP ID, and keeping dev out of search

- **RP ID.** Dev's `VITE_RP_ID` MUST be `dev.cryoshield.app`, never `cryoshield.app`. `deploy.sh` maps `DEPLOY_TARGET=development` to host `dev.cryoshield.app`, so the existing guards hold for the dev host:
  - `apps/web/.env` `VITE_RP_ID` == host;
  - `verify-build --expect-host`: the bundle's RP ID == host.

  `deploy.sh` also refuses, explicitly, any non-production target whose RP ID is the production RP ID. The intent: code that reaches dev without a human step must not be able to request PRF outputs for production vaults. **See threat T1 for why this alone does not fully achieve that.**
- **Noindex, by header only.** `gen-context.mjs --noindex` (passed by `deploy.sh` only for development, and refused for the host `cryoshield.app`) adds `X-Robots-Tag "noindex, nofollow"` to every response, error responses included. Nothing else changes: the CSP, the other headers and the site files stay the same, so the tree hash does too.
  - There is deliberately **no** dev `robots.txt`. A static disallow-all file in `public/` would also ship to production. Another change owns production's `robots.txt` and sitemap (SEO coordination, 2026-10-05). A crawler must also be able to *fetch* a page to see its noindex header. Whatever `robots.txt` the build ships is served unchanged on dev, and the header still keeps dev out of indexes.
  - `smoke.sh` takes `EXPECT_NOINDEX`:
    - `true`: every page must carry exactly `noindex, nofollow`;
    - `false` (production): no page may carry a noindex header, so a dev Caddyfile shipped to production by mistake fails the smoke test and rolls back.
- **Analytics.** `development-build` simply leaves `VITE_CF_BEACON_TOKEN` unset. `write-env.sh` already treats it as optional, and `verify-build --real-env` accepts a build without the beacon.

### 6. Script parametrisation

- `deploy.sh`: `DEPLOY_TARGET` (`production` by default) selects:
  - production: `cryoshield.app`, `cryoshield-web`, `fly.toml`;
  - development: `dev.cryoshield.app`, `cryoshield-web-dev`, `fly.dev.toml`, noindex.

  `DEPLOY_HOST` is refused, so a stale invocation cannot silently target production.
- `previous-image.sh` and `rollback.sh` take `APP` and `CONFIG` (already parameters) from the workflow's `FLY_APP` and `FLY_CONFIG`. `previous-image.sh`'s "not configured" message names the environment (`DEPLOY_ENVIRONMENT`).
- `check-config.sh` names the build environment in its warning (`BUILD_ENVIRONMENT`) and the workflow to re-run (`WORKFLOW`).

### 7. Workflow policy

`workflow-policy.mjs` replaces the single `deploy.yml` rule set with `DEPLOY_PROFILES`, keyed by file. Each profile holds:
- the triggers;
- the push branches, or the release types;
- the exact workflow concurrency group;
- the required first-job conjuncts;
- the release environment and build environment;
- the release job's concurrency group;
- the release job's re-check step id and script.

For each deploy file, the policy enforces:
- only its two environments;
- `FLY_API_TOKEN` only in the step env of steps `deploy` and `rollback` in its release-environment job;
- `VITE_BUNDLER_URL` only in `web-env`, and as a presence check in `config`, in its build-environment job;
- one release job;
- no write scopes at all (the `supersede` exception is gone);
- the digest pinning of every run step in token jobs, per file;
- no build tooling or third-party actions in token jobs.

Every other workflow may name none of the four environments and may not reference `FLY_API_TOKEN`. The zizmor `self-repository` ignore is allowed once per deploy file, pinned to that file's reusable-CI call line.

## Threats

- **T1. Dev code requesting production PRF outputs (open, needs a founder decision).**
  - WebAuthn lets a page use any RP ID that is a registrable-domain suffix of its origin. A page on `dev.cryoshield.app` can therefore call `navigator.credentials.get({ publicKey: { rpId: 'cryoshield.app', extensions: { prf } } })`, and the browser will accept it.
  - The build guards (`.env` RP ID == host, bundle RP ID == host) constrain the *honest* configuration. Code that an agent merges, and that auto-deploys to dev, can build the string at runtime.
  - Such code needs a production-vault user to visit `dev.cryoshield.app` and tap their key. Once it gets a PRF output, though, it can decrypt that user's vault.
  - Mitigations in this change: noindex, no links to dev from production, no analytics, and the dev site is documented as a testnet sandbox.
  - **The complete fix is to serve dev from a different registrable domain**, so `cryoshield.app` is not a suffix of its origin. Candidates:
    - `https://cryoshield-web-dev.fly.dev`: `fly.dev` is on the Public Suffix List, so this is its own registrable domain, at no cost;
    - a separate domain such as `cryoshield-dev.app`.

    The host is a single value in `deploy.sh`, `deploy-dev.yml` and `fly.dev.toml`, so switching is a small follow-up change. The founder specified `dev.cryoshield.app`, so this change implements that and records T1 as a residual risk to close before real users hold production vaults.
- **T2. An agent ships to production.** Blocked by layers 1–3 of decision 4. Write role can push branches, open PRs and dispatch workflows, but:
  - it cannot create, move or delete `v*` tags;
  - a release it publishes on an existing tag, a dispatch, or a re-run it triggers is skipped by the owner gate;
  - a workflow it changes on a branch gets no production secrets.

  Residual: a change merged to `main` reaches production the next time the owner publishes a release from `main`. The owner reviews the generated notes and `release-diff.sh`'s summary, which is the human step CI-C1 asked for.
- **T3. Token confusion.** Both environments hold a secret named `FLY_API_TOKEN`, but GitHub resolves environment secrets per job environment. The policy pins:
  - `deploy.yml`'s token steps to `production`;
  - `deploy-dev.yml`'s token steps to `development`.

  Each token is a Fly deploy token scoped to its own app. A dev token in the wrong environment could only deploy the dev app.
- **T4. A tag moved between build and release.** The release job re-resolves the tag and requires the same commit (`tag-check`). Moving a tag needs admin rights anyway (ruleset).
- **T5. An unreachable or forked commit.** A tag on a commit that is not in `main`'s history (for example a branch the owner tagged by mistake) fails `release-ref.sh` before any build, and again at release time.
- **T6. Dev bundler key abuse.** Dev is public, so its bundler URL is too. `development-build` should hold a separate Pimlico key, restricted to the origin `https://dev.cryoshield.app`, with its own small sponsorship cap (`docs/deploy.md`).
- **T7. Search exposure of a test site.** The noindex header is smoke-tested on every dev deploy. Production is smoke-tested for the *absence* of the header.

## Security review

This section supersedes the review that PR #32 (`remove-production-approval-gate`) lacked; that PR is folded into this change. The audit report's CI-C1 row links here.

### Threat table

| # | Threat | Before (PR #32) | Now | Compensating controls | Residual / decision |
|---|---|---|---|---|---|
| S1 | **Auto-shipped dev code.** Code merged by an agent (PR → LLM review → auto-merge) goes live on `dev.cryoshield.app` with no human step. | It went to **production** the same way. | Dev only. Production needs an owner release. | <ul><li>PR gates: `ci-ok`, ECC review, gitleaks, osv, the OpenSpec gate.</li><li>The full CI is re-run on the merge commit.</li><li>Dev has its own RP ID (`dev.cryoshield.app`), its own Fly app and token, and its own Pimlico key with a small cap.</li><li>noindex; no analytics.</li></ul> | **Accepted for dev**, with T1 below. |
| S2 | **Fly-token-path scripts run with a token and no human step.** These are `.github/scripts/deploy/*`, `apps/web/fly.toml`, `apps/web/fly.dev.toml`, `apps/web/.dockerignore` and `apps/web/deploy/Dockerfile`, all from the deployed commit. | They ran with the *production* token on every merge. | On dev they run with the **dev** token only. On production they run only for an owner-cut tag, so production token use is human-gated. | <ul><li>Release-job run steps are digest-pinned (`privileged-run-steps.json`).</li><li>No build tooling or third-party actions in token jobs.</li><li>`release-diff.sh` flags TOKEN-PATH files in the production run summary.</li><li>The dev token is an **app-scoped deploy token** (`fly tokens create deploy -a cryoshield-web-dev`): it can deploy, roll back and read releases of `cryoshield-web-dev` only, and cannot touch `cryoshield-web` or the org.</li></ul> | **Accepted for dev**: worst case is a defaced or broken dev site, plus T1. |
| S3 | **Production token gated only by owner-only `v*` tags.** | A merge was enough. | It needs a published `v*` release, or a dispatch, by the owner. | <ul><li>Tag ruleset (admin-only bypass).</li><li>The `triggering_actor == repository_owner` gate.</li><li>`production` accepts only `main` and `v*` refs.</li><li>The tag must be on `main`, re-checked right before deploy.</li></ul> | The owner's GitHub account is now the production key. It must keep 2FA (hardware key) and never share admin. |
| S4 | **Cross-target token use** (dev code getting the prod token, or the reverse). | n/a | Blocked. | Per-file policy profiles: each workflow names only its own environments; each environment holds only its own app's token; both are proved by tests. | None known. |
| T1 | **Dev page asserting production credentials** (`rpId: 'cryoshield.app'` from `dev.cryoshield.app`). | Same risk on production itself. | Open. | Not linked from production, noindex, documented as a testnet sandbox. | **Needs a founder decision:** move dev to a separate registrable domain (`cryoshield-web-dev.fly.dev` costs nothing) before real users hold production vaults. |

### Acceptance and the mainnet re-gate criterion

- **Development:** S1, S2 and T1 are accepted by the founder's request ("main merge triggers development deployment"). Dev holds no production credential, and with T1 closed it could not touch production vaults.
- **Production:** the owner-published release is the human step that CI-C1 asked for. No required reviewer is added on top.
- **Re-gate before OP Mainnet.** Before `production-build` points at OP Mainnet, **all** of the following must hold:
  1. T1 is closed: dev is on a separate registrable domain.
  2. `production` regains a required reviewer (`"required_reviewers": ["@owner"]`, `apply.sh --environments --apply`), so a mainnet deploy needs both a release and an approval.
  3. CI-H1 is closed: agents use the machine account only (`docs/agent-account.md`).
  4. The owner's account has hardware-key 2FA.

  Record the check in a `docs/reviews/` entry.

### Review notes

- **Token isolation:**
  - `deploy.yml`'s only token job is `release`, in `production`;
  - `deploy-dev.yml`'s only token job is `release`, in `development`;
  - both are pinned by digest, run no build tooling, and use only `actions/checkout` and `actions/download-artifact`;
  - the policy tests cover cross-environment use (a dev job naming `production`, a production job naming `development`) and token use in any other workflow.
- **Write scopes:** none remain in the deploy workflows. The `supersede` job, which only ever cancelled runs *waiting for an approval* and was dead without one, and its `actions: write` exception were removed.
- **Triggers:** neither workflow can run on `pull_request`; `deploy.yml` has no push or schedule; `release` is limited to `published`.
- **Owner gate:** verified as a required top-level conjunct by the policy, alongside the tag ruleset (admin-only bypass) and the tag-aware environment policies.
- **`apply.sh`:**
  - looks up the owner only when an environment names `@owner`;
  - removes a live reviewer when the committed list is empty;
  - each environment drift test now differs in exactly one property (PR #32 review).
- **Open:** T1 (subdomain RP ID) needs a founder decision. It is not fixable inside the requested design.

The review is done in task 6 and recorded above.

# Design

## Context

`deploy.yml` (from `add-continuous-deploy`) used environment `production` in three jobs:
- `build`, for the variables;
- `deploy`;
- `smoke`.

It also had a workflow-level `deploy-production` concurrency group. If that environment simply gained a required reviewer:
- every release would need **three** approvals;
- a run waiting for approval would block every later run in the group;
- approving the old run would then deploy a stale commit.

The live `production` environment has a `main` branch policy, no reviewers, and `can_admins_bypass: true` (read on 2026-10-05). The owner is user id 30095502. `GET actions/permissions` returns `sha_pinning_required: false`, so the setting exists.

## Goals / Non-Goals

**Goals:**
- One click per release.
- Rollback without a second click.
- No pile-up of waiting runs.
- The newest built commit supersedes a stale waiting one.
- The Fly token stays isolated.

**Non-Goals:**
- Code-owner review.
- An App-posted status for `ecc-review` (CI-H2).
- Creating the machine account (the founder does this).

## Decisions

### 1. One approved job: `release` = deploy + smoke + rollback

`release` is the only job with `environment: production`. Its steps are:
1. Sparse checkout.
2. Download the artifact and verify it.
3. Install flyctl.
4. `deploy`: `previous-image.sh`, then `fly_started=true`, then `fly deploy` (token).
5. Summary.
6. `smoke` (no token).
7. `rollback`, if `(failure() || cancelled()) && steps.deploy.outputs.fly_started == 'true'` (token).
8. Fail loudly.

Rollback is in the same approved job, so it needs no second approval. Because `cancelled()` is included, a cancellation after `fly deploy` started also rolls back.

The registry address and chain for the smoke test come from the verified release manifest's `config.chainId`, plus `contracts/deployments/<chainId>.json` at the same commit. `release` therefore needs no variables from `production-build`.

### 2. `production-build` holds the build configuration

The new `production-build` environment has the `VITE_*` variables and the `VITE_BUNDLER_URL` secret, with a `main`-only branch policy and no reviewers.

*Alternative:* repo-level variables and secret. Rejected: repo-level secrets are available to every workflow on every branch, including same-repo PR runs, whereas an environment with a `main`-only branch policy is not.

The Fly token stays only in `production`, and the policy forbids it anywhere else.

### 3. Concurrency and superseding

**Workflow level:** `concurrency: { group: deploy-${{ github.sha }}, cancel-in-progress: false }`.
- Runs for the same commit (push plus schedule ticks) queue behind each other. GitHub keeps at most one pending run per group, so the 15-minute schedule never stacks runs.
- When the in-flight run finishes, the pending one's `detect` sees `/release.json` equal to `main` and stops.
- Runs for different commits are not blocked, so a newer commit can test and build while an older release waits.

**`release` job level:** `concurrency: { group: deploy-production, cancel-in-progress: false }`. Only one release holds the group (waiting or deploying), a deploy is never cancelled by concurrency, and a newer release is pending.

**`supersede` job** (needs `detect` and `build`, runs before `release`; `actions: write`; `GITHUB_TOKEN` only): `.github/scripts/deploy/supersede.sh` lists `deploy.yml` runs with status `waiting`. For each one that is:
- older than this run (by `created_at`, or by id on a tie);
- for a different commit;
- **still has a pending `production` deployment** (`GET runs/{id}/pending_deployments`, re-checked immediately before acting);

it cancels the run (`POST runs/{id}/cancel`).

Waiting runs have not deployed anything, so cancelling them is safe. Runs that are deploying have status `in_progress` and are never listed. Because `supersede` runs only after the new commit's full CI and build succeed, a broken newer commit never cancels a good waiting release.

GitHub has no way to cancel only waiting jobs through concurrency, which is why this is a step.

**Residual race:** the owner approves old run A between `supersede`'s re-check and its cancel call. Then A is cancelled while starting, and its `rollback` step (on `cancelled()`) restores the previous image if `fly deploy` had begun. B's release then deploys the newer commit after approval. The window is milliseconds and fails safe.

### 4. Policy (`workflow-policy.mjs`)

For `deploy.yml`:
- a job references `FLY_API_TOKEN` ⇔ the job's environment is `production`;
- at most one `production` job;
- `production-build` jobs never hold the token;
- the `production` job has job-level `deploy-production` concurrency with `cancel-in-progress: false`;
- the workflow-level group is `deploy-${{ github.sha }}` with `cancel-in-progress: false`.

The generic rule "only read/none job permissions" gains one exception: `deploy.yml` job `supersede` may have `actions: write`, and that job may hold no secrets other than `github.token`.

The secret allow-list is unchanged:
- `FLY_API_TOKEN` in the step env of `deploy` and `rollback` (`production` job);
- `VITE_BUNDLER_URL` in `web-env` (`production-build` job).

The release job's run steps stay digest-pinned.

### 5. `apply.sh --environments` and `--founder-hardening`

`--environments`:
- `production`: `PUT` with `reviewers: [{type: User, id: <gh api users/<owner> .id>}]`, `can_admins_bypass: false`, `prevent_self_review: false` (solo maintainer), `wait_timer: 0`, and a custom branch policy.
- `production-build`: a custom branch policy only.
- Branch policies are reconciled to exactly `branch:main`.
- Like the rest of the script, it diffs a normalised summary, writes only on drift, and re-checks afterwards.

`--founder-hardening` (off by default) enables:
- Dependabot security updates (`PUT automated-security-fixes`);
- vulnerability alerts (`PUT vulnerability-alerts`);
- `PUT actions/permissions {enabled: true, allowed_actions: "all", sha_pinning_required: true}`. All workflow actions are already SHA-pinned, and the policy enforces that.

### 6. Agent account (CI-H1)

`docs/agent-account.md`:
- a machine user (GitHub allows one per person) invited with **Write**;
- a fine-grained PAT for this repository only, with:
  - Contents: read/write;
  - Pull requests: read/write;
  - Issues: read/write;
  - Metadata: read;
  - **no** Administration, and **no** Workflows.

  The trade-off: without Workflows the agent cannot push changes under `.github/workflows/`. Those edits are then made by the owner or come from a reviewed PR branch the owner pushes. That is deliberate, since workflow edits are the highest-risk change.
- **Found while writing the doc:** a fine-grained PAT cannot reach a repository where its user is only a collaborator on another *personal* account. `prix0007/cryoshield` is personal-owned, so the doc offers two options:
  - **A (recommended):** move the repo to an organization the owner controls, which allows an org-owned, repo-only fine-grained PAT with org approval;
  - **B:** a classic PAT with the `repo` scope only (no `workflow` or `admin:*`).

  In both, the boundary is the account's Write role: rulesets, environments, secrets and settings need Admin whatever scopes the token has.
- `gh` and git configuration: `GH_TOKEN` in the agent's environment, a separate SSH key, and an `includeIf` gitconfig.
- Verification: a rulesets or environments write must fail with 403 or 404.

## Threats / abuse

| Threat | Mitigation |
|---|---|
| A malicious or LLM-steered PR auto-merges | It reaches `main` but **not production**: the owner reviews the release (commit, diff link, build summary) before approving. |
| The admin token is used by agents to bypass rules | The agents' machine account has Write only, with a fine-grained PAT that has no Administration permission. |
| An approval is spent on a stale commit | Superseding cancels older waiting runs once a newer commit is built. |
| Runs pile up while waiting | Per-commit workflow concurrency plus job-level `deploy-production`. |
| The Fly token leaks through the build | The token exists only in `production`, used by one job that runs no build code (policy). The build environment has no token. |
| An admin bypasses the gate | `can_admins_bypass: false`. The owner can still edit the environment (audit-logged), and `apply.sh` reports the drift. |
| The `supersede` job is abused | `GITHUB_TOKEN` only, `actions: write`. It cancels only older waiting `deploy.yml` runs in this repo and runs only after a successful build of a newer `main` commit. `actions: write` would also allow `workflow_dispatch`, re-runs and artifact/log deletion, but the job runs only repo scripts at the tested commit, and any deploy still needs the approval. |
| An auto-merged PR changes a script that runs with the token (`previous-image.sh`, `rollback.sh`, `fly.toml`, the Docker context) | `release-diff.sh` writes the diff against the live commit to the run summary before the approval and flags every token-path file (TOKEN-PATH CHANGED). The owner reads those before clicking. Follow-up once agents use the machine account: code-owner review on these paths. |
| An older commit is approved after a newer one | The release re-checks `main`'s HEAD after the approval and refuses a stale commit. |

## Risks / Trade-offs

- **Every release waits for the owner,** so deploys may lag merges. That is intended.
- **Without the Workflows permission, agents can't push workflow changes.** Those go through the owner.
- **The supersede race** (decision 3) fails safe through rollback on cancellation.

## Migration Plan

1. The founder creates `production-build`. `apply.sh --environments --apply` creates it, but variables must be set by hand.
2. The founder moves the `VITE_*` variables and the `VITE_BUNDLER_URL` secret into `production-build`, keeping `FLY_API_TOKEN` in `production`. Commands are in `docs/deploy.md`.
3. Merge this PR.
4. The overwatcher runs `.github/rulesets/apply.sh --with-ecc-review --environments --apply`, and with `--founder-hardening` after the founder confirms.
5. The founder sets up the machine account (`docs/agent-account.md`).

Until steps 1 and 2 are done, `build` fails on missing variables and nothing is deployed (fail closed).

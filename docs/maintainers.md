# Maintainer reference

CI, branch protection and deployment details, moved out of the README. The agent and contributor flow is in [`CLAUDE.md`](../CLAUDE.md) → "Change flow".

## Continuous integration

`.github/workflows/ci.yml` runs one job per area. Each job runs only when its paths change:
- `contracts`: build, tests, gas snapshot, Slither
- `vault-crypto`: Node and Chromium
- `recover`: Python 3.10 and 3.12
- `web`
- `openspec`: strict validation
- `workflow-lint`

- `pr-checks` (pull requests only), which runs on every PR event and checks:
  - the title follows Conventional Commits;
  - the OpenSpec gate passes;
  - gitleaks finds no secrets in the PR's commits;
  - osv-scanner finds no HIGH/CRITICAL vulnerabilities in any lockfile.

A final **`ci-ok`** job aggregates the results. Skipped jobs count as passing; failed or cancelled jobs fail it.

How the workflow is hardened:
- triggers are `push` (main) and `pull_request` only;
- `permissions: contents: read` at the top, and every job declares its own minimal permissions and a `timeout-minutes`;
- no secrets are referenced; PR title, body and labels reach scripts only through `env:`;
- every action is pinned by commit SHA, and the scanners are pinned by version and SHA-256 (Dependabot keeps them updated);
- checkouts don't persist credentials, and installs fail on lockfile drift;
- superseded PR runs are cancelled.

`workflow-lint` enforces these rules with actionlint, zizmor (pedantic persona) and `.github/scripts/workflow-policy.mjs`. Inline `zizmor: ignore` comments are rejected.

The gate scripts live in `.github/scripts` and are tested with `npm ci --ignore-scripts --prefix .github/scripts && npm test --prefix .github/scripts`.

## Pull request rules

`main` is protected by the ruleset in `.github/rulesets/main.json`. Every change, including the maintainer's, goes through a pull request. The step-by-step flow for agents and humans is in [`CLAUDE.md`](../CLAUDE.md) → "Change flow (one PR per change)". AI agents work through a non-admin machine account ([`docs/agent-account.md`](agent-account.md)), so they cannot change protection, environments or secrets.

1. **OpenSpec first.** Propose a change under `openspec/changes/<name>/` before writing code.
   - A PR that touches code or CI configuration (`apps/`, `packages/`, `contracts/src/`, `tools/recover/src/`, `tools/metrics/`, `.github/`, `scripts/`, `.gitleaks.toml`, the root workspace manifests or `contracts/foundry.toml`) must also add or modify something under `openspec/changes/`, archiving included.
   - The only exception is the `no-spec` label plus a `No-spec justification: <reason>` line in the PR description.
   - Dependabot PRs that touch only dependency manifests are exempt.
2. **Branch** from `main` with a prefix: `feat/`, `fix/`, `ci/`, `docs/` or `chore/`, for example `feat/shamir-recovery`.
3. **PR title** in Conventional Commits form, `type(scope)!: subject`, for example `fix(recover): handle empty log page`. It becomes the commit on `main`.
4. **Fill in the PR template:**
   - the OpenSpec change;
   - the tasks covered;
   - verification (the tests you ran);
   - a security-review link, or N/A;
   - screenshots for UI changes.
5. **ECC review** (`.github/workflows/ecc-review.yml`):
   - it runs **automatically only for trusted authors**: the repository owner, or a login in [`.github/trusted-authors.json`](../.github/trusted-authors.json) on `main` (OpenSpec change `gate-external-pr-automation`);
   - for anyone else (Dependabot included), or when an untrusted account pushes to a trusted PR, the `ecc-review` check fails at once with "Awaiting owner approval". The owner reads the PR and comments `/ecc-review <head sha>` (7 or more characters) to run the review for that commit. Every new push, and every re-run, needs a new approval;
   - each review comes from the ECC reviewer agents chosen by path, once per approved push;
   - it posts *request changes* on CRITICAL/HIGH findings, *comment* otherwise;
   - push fixes to re-run it, or, as the owner, comment `/ecc-review`;
   - fork PRs are refused. To take a fork contribution, the owner reads it and re-pushes its commits to a branch in this repository;
   - it needs `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) or `ANTHROPIC_API_KEY`, as both an Actions secret and a Dependabot secret.
6. **Auto-merge** (`.github/workflows/auto-merge.yml`):
   - every same-repo, non-draft PR **by a trusted author** squash-merges by itself once all required checks pass;
   - PRs by anyone else (Dependabot included) are never auto-merged: the owner merges them by hand after review;
   - it is active only while `ecc-review` is a required check;
   - the `hold` label is the owner's veto.
7. **Merge rules:**
   - `ci-ok` and `ecc-review` must be green (the branch need not be up to date; `main` is re-tested before deploy);
   - all conversations must be resolved;
   - squash merge only, so history stays linear;
   - force-pushes to `main` and deleting it are blocked;
   - no approval is required, since the single maintainer cannot approve their own PRs. `.github/CODEOWNERS` still requests the owner on every PR, and the trusted-author gate above stands in for code-owner approval;
   - nobody can bypass these rules.

8. **Fork PRs** need a maintainer's "Approve and run" before *any* workflow runs, whatever the contributor's history. The repository's fork-PR approval policy is `all_external_contributors` (`.github/rulesets/fork-pr-approval.json`, applied by `apply.sh`). Fork runs of `ci.yml` never get secrets.

Secret-scan exceptions are in `.gitleaks.toml` (public test vectors only). Vulnerability exceptions are in `.github/osv-scanner.toml`; each needs a reason and expires within 90 days. Changing either one needs a security review.

**Applying the ruleset (repository admin, `gh auth login` with admin rights):**

```sh
.github/rulesets/apply.sh           # dry run: diff of live vs committed (exit 3 on drift)
.github/rulesets/apply.sh --apply   # create/update only what differs; idempotent
```

The script syncs:
- the `main` ruleset;
- the repository merge settings in `.github/rulesets/repo-settings.json` (squash only, PR title as the commit title, delete the branch on merge);
- the Actions workflow permissions in `.github/rulesets/actions-permissions.json` (read-only default token; Actions may not approve PRs);
- the fork-PR workflow approval policy in `.github/rulesets/fork-pr-approval.json` (`all_external_contributors`: every fork PR waits for approval);
- the managed labels in `.github/rulesets/labels.json`;
- auto-merge, enabled in the repository settings;
- with `--environments`: the deploy environments in `.github/rulesets/environments.json` (`production`: the owner as required reviewer, no admin bypass, `main` only; `production-build`: `main` only);
- with `--founder-hardening` (off by default): Dependabot security updates and "actions must be pinned to a full commit SHA" (`.github/rulesets/actions-hardening.json`).

`ecc-review` is **not** a required check by default, and auto-merge stays off until it is.

To enable both:
1. Add the `CLAUDE_CODE_OAUTH_TOKEN` secret (or `ANTHROPIC_API_KEY`) twice: as an Actions secret and as a Dependabot secret.

   ```sh
   claude setup-token
   gh secret set CLAUDE_CODE_OAUTH_TOKEN
   gh secret set CLAUDE_CODE_OAUTH_TOKEN --app dependabot
   ```
2. Wait until an ECC review has succeeded on a PR.
3. Run `.github/rulesets/apply.sh --with-ecc-review --apply`.

Keep passing `--with-ecc-review` from then on: without it, `--apply` refuses to drop the requirement.

To change protection, edit those files in a PR and re-run the script after it merges.

## Deployment

There are two targets (OpenSpec change `split-dev-and-release-deploys`):

- **Development, https://cryoshield-web-dev.fly.dev** (OP Sepolia, not indexed). It is served on its own `fly.dev` name, a different registrable domain from `cryoshield.app`, so its RP ID can never reach production vaults. Every new commit on `main` is deployed there automatically by `.github/workflows/deploy-dev.yml`.
- **Production, https://cryoshield.app.** It is deployed only when the repository owner publishes a release: `gh release create vX.Y.Z --target main --generate-notes`. `.github/workflows/deploy.yml` then deploys that tag. Only admins can create tags, `v*` or any other (ruleset `release-tags`, `~ALL`), and the workflow runs only for the owner.

Both pipelines run the same stages:

1. **detect:** the dev pipeline compares `/release.json` with `main`'s HEAD and skips if they are equal. The production pipeline resolves the tag and refuses a commit that is not on `main`.
2. **test:** run the **full** `ci.yml` on that exact commit.
3. **build** (no deploy token): run the guarded `DEPLOY_TARGET=<target> apps/web/deploy/deploy.sh --build-only` in the target's build environment (`development-build` or `production-build`).
4. **release** (Environment `development` or `production`, no manual approval): run pinned flyctl on the verified build artifact, then check the routes, headers (noindex on dev only), registry address and `/release.json`. On failure, roll back to the previous image automatically in the same job.

Neither pipeline runs on pull requests. To roll production back, run `gh workflow run deploy.yml --ref vX.Y.Z` with an earlier release tag. Production secrets are reachable only from `v*` tags, and only admins can create tags. To redeploy dev, run `gh workflow run deploy-dev.yml --ref main -f force=true`. See [`docs/deploy.md`](deploy.md) for first-time setup and token rotation.

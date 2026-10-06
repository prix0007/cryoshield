> **Archive after:** adopt-ecc-review-and-auto-merge (this change MODIFIES its "Automatic ECC review of pull requests" and "Auto-merge with an owner veto" requirements, which are not yet in `openspec/specs/contribution-workflow`).

# Proposal

## Why

CryoShield is a public open-source repository. The founder asked: "since it's a OSS let make sure you only my pushed PR run pipeline automatically for everything else need approval from codeowner."

Today:
- `ecc-review.yml` runs on `pull_request_target` for **every** same-repo, non-draft pull request, whoever opened it, and spends the Claude credential (`CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY`) on each push. Dependabot PRs are reviewed automatically too.
- `auto-merge.yml` turns on auto-merge for every same-repo, non-draft, non-Dependabot PR, whoever opened it.
- Fork PRs run `ci.yml` (`pull_request`, no secrets) under GitHub's default approval policy, which only asks for approval for first-time contributors.

So any account with the Write role, and any returning fork contributor, gets automation that only the owner should get automatically.

## What Changes

- **Trusted authors.** A PR author is trusted when they are the repository owner (`github.repository_owner`) or are listed in `.github/trusted-authors.json`, read from the **default branch** (never from the PR). The list starts as `["prix0007"]`. The future machine account (`docs/agent-account.md`) is added to it when it is created. The workflow policy validates the file (GitHub logins only, no bots, no wildcards).
- **`ecc-review` is automatic only for trusted authors.** Both the PR author and the event sender (the pusher) must be trusted. For anyone else, a new second step (after the fork refusal, before any credential, checkout or model call) **fails the required check at once** with "Awaiting owner approval". The owner approves one commit by commenting `/ecc-review <head sha>` on the PR, through the existing owner-only re-run path. The re-run passes the gate only if that unedited owner comment names the run's head commit and post-dates the run's event, with one approval per re-run attempt.
- **`auto-merge` is enabled only for trusted authors.** The author and the sender are re-checked on every push (`synchronize` is added). For anyone else, the workflow switches auto-merge off and the owner merges by hand after review.
- **Fork PRs need approval to run any workflow.** The repository's fork-PR workflow approval policy becomes `all_external_contributors`, managed as code: `.github/rulesets/fork-pr-approval.json`, synced by `.github/rulesets/apply.sh` (dry run by default, `--apply` to write) through `PUT repos/{owner}/{repo}/actions/permissions/fork-pr-contributor-approval`.
- **Code owner.** `.github/CODEOWNERS` already assigns `*` to `@prix0007`, so the owner is requested on every PR. The `main` ruleset keeps `require_code_owner_review: false` (design decision 6).
- **Workflow policy.** `.github/scripts/workflow-policy.mjs` enforces the author gate in both privileged workflows (position, exact inputs, fail-closed exit, guarded later steps) and validates `trusted-authors.json`. The changed privileged run steps are re-pinned in `privileged-run-steps.json`.
- **Docs.** `CLAUDE.md` (Change flow), `README.md` (Contributing), `docs/agent-account.md` (add the machine account to the trusted list).

**Out of scope:**
- Reviewing fork PRs with ECC. Forks stay refused by `ecc-review`; the owner re-pushes a fork's commits to a branch in this repository after reading them, as today.
- Requiring code-owner approval in the ruleset (decision 6 explains why it would break the owner's own PRs and auto-merge).
- Changing `ci.yml`: same-repo branches keep running it on `pull_request`; fork runs are gated by the approval policy.
- Creating the machine account or transferring the repository to an organization.

**Runtime dependencies:** none. No CryoShield-operated backend. Only GitHub Actions configuration and repository settings change.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `contribution-workflow`: automatic ECC review and auto-merge are limited to trusted authors; the owner approves other PRs' reviews with `/ecc-review`; fork-PR workflow approval is managed as code.
- `ci-pipeline`: the workflow policy enforces the trusted-author gate and validates the trusted-authors list.

## Impact

- `.github/workflows/ecc-review.yml`, `.github/workflows/auto-merge.yml`
- `.github/trusted-authors.json` (new), `.github/CODEOWNERS` (comment only)
- `.github/scripts/workflow-policy.mjs`, `.github/scripts/privileged-run-steps.json`, `.github/zizmor.yml` (pinned trigger lines)
- `.github/rulesets/fork-pr-approval.json` (new), `.github/rulesets/apply.sh`
- `.github/scripts/test/privileged-workflows.test.mjs`, `.github/scripts/test/author-gate.test.mjs` (new), `.github/scripts/test/apply-sh.test.mjs`, `.github/scripts/test/fixtures/gh-stub.sh`
- `CLAUDE.md`, `README.md`, `docs/agent-account.md`, `.github/pull_request_template.md` (Review section)

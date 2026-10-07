# Proposal

## Why

The founder wants CryoShield's review and merge process to match their other project, outlai. In that process:
- every PR gets an automatic, multi-reviewer ECC review that can block it;
- PRs merge themselves once every required check is green;
- the owner keeps a one-label veto.

CryoShield has no external audit, so an automatic adversarial review on every PR adds a second line of defence beyond CI. It is especially useful for the crypto, contract, recovery and CI paths.

## What Changes

- **`.github/workflows/ecc-review.yml`**, adapted from outlai with every safeguard kept:
  - `pull_request_target`, so the workflow always comes from `main`; fork PRs are refused in the first step;
  - the PR head is checked out read-only, with no git credentials left behind;
  - the `.claude/`, `.mcp.json` and `CLAUDE.md` agent configuration is restored from the base commit;
  - the ECC plugin is pinned, verified and moved out of the workspace, and its `.mcp.json` is removed;
  - the agent has no Bash and can write only to the review directory, with subprocess credential scrubbing under bubblewrap;
  - a separate step posts ONE review (`request-changes` or `comment`) after a credential-shaped-output guard;
  - a gate step dismisses superseded bot blocks;
  - an owner-only `/ecc-review` rerun job;
  - the check fails closed without a Claude credential secret.

  Reviewers are chosen from CryoShield paths, the PR's OpenSpec change and `CLAUDE.md`. The model is a single `REVIEW_MODEL` env var.
- **`.github/workflows/auto-merge.yml`:** it enables `gh pr merge --auto --squash --delete-branch` for non-draft, same-repo PRs. The `hold` label is the owner veto, and the workflow never checks out code.
- **Workflow policy:** `pull_request_target` and `issue_comment` stay forbidden everywhere except these two named files. Those two must keep their fork guards, never run PR code, and keep their write scopes inside a per-file allow-list. This is enforced by `workflow-policy.mjs` with tests.
- **Ruleset tooling:**
  - `apply.sh` creates the `hold` label;
  - `repo-settings.json` enables `allow_auto_merge`;
  - a new `--with-ecc-review` flag also requires the `ecc-review` check.

  The default ruleset does NOT require `ecc-review` yet. The secret does not exist, so every PR would fail.
- **Docs:**
  - new `CLAUDE.md` with project rules and a "Change flow (one PR per change)";
  - new `AGENTS.md` pointing to it;
  - the PR template gains outlai's "Tasks covered", "Verification" and "Review" sections and keeps OpenSpec, security, screenshots and `No-spec justification:`.
- **Runtime dependencies: none.** This is CI and repository configuration only, not a CryoShield-operated backend.
- **New CI dependencies:**
  - `anthropics/claude-code-action` v1.0.240;
  - the ECC plugin v2.2.3 (`affaan-m/ECC`), pinned by commit;
  - a reviewer credential secret (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`) that the founder adds. Review traffic goes to Anthropic's API.

**Out of scope:**
- making `ecc-review` required (a follow-up `apply.sh --with-ecc-review --apply` after the secret exists);
- reviewing fork PRs automatically;
- merge queues;
- auto-updating PR branches. Strict "up to date" still needs a manual branch update after `main` moves.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `contribution-workflow`: adds automatic ECC review, auto-merge with an owner veto, and the agent change flow docs. It changes the PR template requirement.
- `ci-pipeline`: the supply-chain requirement now allows privileged triggers only in two named, guarded workflows.

## Impact

- New files:
  - `.github/workflows/ecc-review.yml` and `auto-merge.yml`;
  - `CLAUDE.md` and `AGENTS.md`.
- Edited files:
  - `.github/scripts/workflow-policy.mjs` and its tests;
  - `.github/rulesets/` (`apply.sh`, `repo-settings.json`, `main.json` support);
  - `.github/pull_request_template.md` and its test;
  - `README.md`.
- Merges done by `auto-merge` use the workflow token. GitHub does not start `push` workflows for them, so the PR's own checks, kept up to date with `main` by strict mode, are the verification.
- `ecc-review` runs only after this change is on `main`, because `pull_request_target` workflows come from the base branch.

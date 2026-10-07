# Proposal

## Why

CodeQL default setup is now on, and it raised two alerts on CI code:
- **#3, `js/bad-tag-filter`, `.github/scripts/triage.mjs:227` (real, low).** The comment composer stripped HTML comments with regexes. The triager showed that a single-pass delimiter strip re-forms a comment: `<<!!-- x --<!>` became `<!-- x -->`. Agent text could then hide content in the triage comment, and it broke invariant M1 of `add-issue-triage`: no comment syntax or forged `cryoshield-triage-run` marker in agent text.
- **#1, `actions/untrusted-checkout/high`, `.github/workflows/ecc-review.yml:87` (hardening).** The privileged review job checked the PR head out as the workspace root. Nothing from it was executed, and the agent-config files were restored from the base commit. Even so, every other file at the root came from the PR, where Claude Code or the action could read it as configuration.

## What Changes

- **`triage.mjs` `composeComment`:** HTML-escape `<` and `>` in the agent text and break up marker names (`cryoshield-triage-` becomes `cryoshield triage `). This replaces the regex strip. The text stays readable, since GitHub renders `&lt;` and `&gt;` as the characters. Regression tests cover `<<!!--` / `--<!>`, `--!>`, tags, and the inert display.
- **`ecc-review.yml`:**
  - The workspace root is a checkout of the **base commit**, and the PR head is checked out into **`pr/`**.
  - The credential assertion covers both checkouts.
  - The base-config restoration now runs inside `pr/`, and also covers nested `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `.claude/` and `.mcp.json`.
  - The agent is told to review `./pr/`, reads project rules from the base, and is denied `./pr/.git/**`.
- **`workflow-policy.mjs`:**
  - The ECC profile requires the head checkout to have `path: pr`, and the base checkout to be the root.
  - New `ECC_DISALLOWED_TOOLS` constant. The triage profile is unchanged.
  - Reviewed run-step digests are updated, and the policy tests assert the layout.
- **Runtime dependencies: none.**

**Note:** this PR changes a workflow, so GitHub does not let the auto-merge bot merge it. The overwatcher merges it by hand once it is green.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `ci-pipeline`: the review workspace holds no PR content at its root, and triage comments escape agent text.

## Impact

- `.github/scripts/triage.mjs`, `.github/workflows/ecc-review.yml`, `.github/scripts/workflow-policy.mjs`, `.github/scripts/privileged-run-steps.json`, and tests.
- Both CodeQL alerts (#1, #3) should close when this merges to `main`.

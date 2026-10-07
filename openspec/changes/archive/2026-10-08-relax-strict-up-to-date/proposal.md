# Proposal

## Why

The founder asked why PRs were not auto-merging. With strict mode ("require branches to be up to date"), every merge leaves the other open PRs behind `main`. Auto-merge then stalls until someone rebases each one by hand. Automatic rebasing would need an extra credential, because GitHub ignores pushes made with the workflow token, and merge queues are not available on user-owned repositories.

Strict mode is no longer the only guard against an untested combination reaching users: since `add-continuous-deploy`, every `main` commit runs the full CI again before it is deployed, and a failed smoke test rolls back.

## What Changes

- The `main` ruleset no longer requires branches to be up to date: `strict_required_status_checks_policy: false`. `ci-ok` and `ecc-review` stay required on the PR's own head commit.
- CLAUDE.md, the README and the spec are updated: a combination that breaks after merge is caught by the deploy pipeline's full CI on `main`, before it goes live.

**Out of scope:** merge queue, auto-rebase bots, and any change to the required checks themselves.

**Runtime dependencies:** none. No CryoShield-operated backend.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `contribution-workflow`: the "Main branch protection as code" requirement drops the up-to-date condition.

## Impact

- `.github/rulesets/main.json`
- `.github/scripts/test/ruleset-files.test.mjs`
- `CLAUDE.md`
- `README.md`

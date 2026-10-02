# Proposal

## Why

The founder asked to "adopt a PR workflow and make sure to CI harden the codebase in PRs". Today `main` has no enforced protection: commits can land without CI, OpenSpec-first is only a convention, and nothing scans pull requests for leaked secrets or vulnerable dependencies. The repository is private on GitHub Pro with a single maintainer, so rulesets are available, but GitHub Advanced Security (dependency review, CodeQL, native secret scanning) is not; the gates have to be built from free, pinned tools.

## What Changes

- **Ruleset as code** (`.github/rulesets/main.json` and an idempotent `apply.sh` that diffs and then applies it via `gh api`). It requires PRs into `main` with 0 approvals but conversation resolution, the `ci-ok` check from GitHub Actions with strict "up to date", linear history and squash-only merges, blocks force-pushes and deletion, and has no bypass actors.
- **PR hygiene:** a PR template (OpenSpec change, tests run, security-review link or N/A, UI screenshots) and `.github/CODEOWNERS`.
- **New PR-only job `pr-checks`, required through `ci-ok`.** It covers:
  - a Conventional Commits PR title;
  - an OpenSpec gate: a PR touching code paths must touch `openspec/changes/`, or carry a `no-spec` label with a written justification;
  - gitleaks (CLI, pinned by version and SHA-256) over the PR's commit range, with a narrow `.gitleaks.toml` allowlist for public test vectors;
  - osv-scanner (pinned by version and SHA-256) over every lockfile, failing on HIGH/CRITICAL, with a reviewed and expiring ignore file.
- **Workflow policy check** (`workflow-lint`): a tested script fails on `pull_request_target`, a missing workflow or job `permissions`, a missing `timeout-minutes`, a `secrets.*` reference, or any attempt to switch off zizmor checks (inline ignores, or a weakened hash-pin policy). SHA pinning and `persist-credentials` stay with zizmor, which moves to the pedantic persona.
- `pull_request` activity types now include `edited`, `labeled` and `unlabeled`, so the title and label gates re-evaluate.
- **Dependabot** is extended to npm (the pnpm workspace and the two tool lockfiles), uv (`tools/recover`) and Docker (`apps/web/deploy/Dockerfile` digest). Updates are grouped weekly with a cooldown, and nothing auto-merges.
- **README "Contributing / PR workflow"** covers branch naming, the OpenSpec-first rule, squash merges, and how to apply the ruleset.
- **Runtime dependencies: none.** Every addition is CI or repository configuration on GitHub-hosted runners, not a CryoShield-operated backend. New CI-only tools: gitleaks 8.30.1, osv-scanner 2.6.0, and the `yaml` 2.9.1 npm package (locked) for the policy script.

**Out of scope:**
- changing GitHub settings or pushing; the overwatcher runs `apply.sh`;
- the GitHub Advanced Security features (not available on this plan);
- fixing vulnerable dependencies owned by other areas (reported and time-boxed in the ignore file instead);
- signed commits;
- merge queues;
- release automation.

## Capabilities

### New Capabilities
- `contribution-workflow`: how changes reach `main`. It covers branch protection as code, PR requirements (template, code owners, merge method) and the OpenSpec-first gate on PRs.

### Modified Capabilities
- `ci-pipeline`: adds PR-only hardening gates (title, secret scan, vulnerability audit) and a stricter workflow-security policy (no privileged PR trigger, explicit permissions and timeouts everywhere, non-suppressible lint).

## Impact

- New files:
  - `.github/rulesets/`;
  - `.github/scripts/` (gate scripts, their tests and a one-dependency lockfile);
  - `.github/pull_request_template.md` and `.github/CODEOWNERS`;
  - `.gitleaks.toml` and `.github/osv-scanner.toml`.
- Edited files:
  - `.github/workflows/ci.yml` (new `pr-checks` job; named steps; zizmor in the pedantic persona);
  - `.github/dependabot.yml`;
  - `README.md`.
- PR runs become slightly longer (about 1 to 2 minutes for `pr-checks`), and an edited title or body re-runs CI.
- The ruleset takes effect only after the overwatcher runs `.github/rulesets/apply.sh --apply`.

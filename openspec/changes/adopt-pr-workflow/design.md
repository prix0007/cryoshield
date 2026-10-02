# Design

## Context

Current state:
- `ci.yml` (from `add-ci`) runs path-filtered area jobs plus an aggregate `ci-ok` job.
- It is already hardened: SHA pins, `contents: read`, no secrets, `persist-credentials: false`, timeouts on every job, PR concurrency, and actionlint and zizmor in `workflow-lint`.
- Branch protection was only documented as a manual step.

Constraints:
- The repo is private on GitHub Pro, so rulesets are available but GitHub Advanced Security is not.
- There is one maintainer, so a required approval can never be satisfied: GitHub forbids self-approval.
- The CI engineer may not change GitHub settings; the overwatcher applies the ruleset.

Baseline local scans of `origin/main` at 9cfc703:
- gitleaks found 23 hits, all `generic-api-key` on hex fields of `packages/vault-crypto/test-vectors/v1.json`, both in the tree and in history;
- osv-scanner found 1 CRITICAL, 3 HIGH and 7 MEDIUM, all under the `@dha-team/arbundles` devDependency of `apps/web` (see decision 8).

## Goals / Non-Goals

**Goals:**
- Make the PR the only path to `main`, gated by `ci-ok`, with the rules kept as reviewable code.
- Add the PR gates the plan does not provide natively: secret scanning, dependency audit, OpenSpec-first and title format.
- Keep every new tool pinned and checksummed, and every new piece of logic in a tested script.

**Non-Goals:**
- Paid GHAS features.
- Merge queue.
- Signed-commit enforcement (no signing keys are provisioned yet; a later change can add `required_signatures`).
- Fixing other areas' dependencies.

## Decisions

### 1. Ruleset `.github/rulesets/main.json`

The ruleset is in the REST API format. It targets `~DEFAULT_BRANCH` and is `active`. Its rules:
- `deletion` and `non_fast_forward`;
- `required_linear_history`;
- `pull_request`:
  - 0 approvals;
  - `required_review_thread_resolution: true`;
  - `dismiss_stale_reviews_on_push: true`;
  - `allowed_merge_methods: ["squash"]`;
- `required_status_checks`:
  - `ci-ok`, pinned to `integration_id: 15368` (the GitHub Actions app), so no other app or commit-status API caller can satisfy it;
  - `strict_required_status_checks_policy: true`.

**No bypass actors.** In an emergency the admin can still edit or disable the ruleset. That is a deliberate action, recorded in the audit log, not a silent per-merge bypass. *Alternative:* admin bypass "for pull requests only". Rejected because it would let the only maintainer merge red PRs without leaving a trace in the ruleset.

### 2. `apply.sh`

The script defaults to a dry run. It looks up the ruleset by name and prints a unified diff between the committed file and the live ruleset, both normalized. Normalization is in `.github/scripts/ruleset-normalize.mjs`: it keeps only the keys the committed file declares, sorts rules by type and sorts keys. This avoids perpetual diffs from server-added defaults.

`--apply` POSTs when the ruleset is missing, PUTs when it differs, and does nothing when it matches, so the script is idempotent. It also diffs and applies the repository merge settings (`.github/rulesets/repo-settings.json`):
- squash merges only;
- PR title as the squash commit title;
- delete branch on merge.

This makes the merge buttons match the ruleset.

The `gh` binary can be overridden (`GH=`), so the tests run against a stub.

### 3. One workflow

`pr-checks` lives in `ci.yml` and is added to `ci-ok.needs`. The `pull_request` trigger gains the `edited`, `labeled` and `unlabeled` types, so title and label fixes re-run the gates.

Every job runs on every PR event. Skipping the area jobs on `edited` events would let a later, partially skipped run report a green `ci-ok` for the same SHA, which is a bypass. The cost is a full re-run on a title, body or label edit; concurrency cancels the superseded run.

*Alternative:* a separate workflow plus a second required check. Rejected; `ci-ok` stays the single required check (`add-ci` decision 1).

### 4. Gate scripts in Node 22 ESM, tested with `node:test`

The scripts live in `.github/scripts/`. The only dependency is `yaml@2.9.1`, which has no transitive dependencies. It is installed with `npm ci --ignore-scripts` from a committed lockfile, the same pattern as `.github/openspec-cli`. Scripts read their inputs from the environment or files; GitHub expressions are never interpolated into `run:`.

Tests: `npm test --prefix .github/scripts`.

### 5. OpenSpec gate

Inputs:
- the changed files (`git diff --name-only BASE...HEAD`, merge-base semantics, from a `fetch-depth: 0` checkout);
- the PR author, its labels (as JSON) and its body.

Code path prefixes:
- `apps/`
- `packages/`
- `contracts/src/`
- `tools/recover/src/`
- `.github/workflows/`

Spec evidence is any changed path under `openspec/changes/`, which includes the archive.

Exemption: the `no-spec` label plus a `No-spec justification:` line of at least 10 characters.

**Assumption A1: Dependabot exemption.** A PR authored by `dependabot[bot]` passes when every changed file is a dependency manifest: `package.json`, `pnpm-lock.yaml`, `package-lock.json`, `pyproject.toml`, `uv.lock`, a `Dockerfile`, or a workflow file. Otherwise each weekly Dependabot PR would need a manual body edit. The author login is set by GitHub and cannot be spoofed by a fork. Dependabot cannot touch source files, so the exemption cannot carry code.

### 6. PR title

The regex is `^(feat|fix|docs|chore|ci|build|refactor|perf|test|style|revert)(\([a-z0-9._/-]+\))?!?: \S.*$`, at most 100 characters. It matches the repository's existing commit history and Dependabot's `ci`/`chore(deps)` prefixes.

### 7. gitleaks 8.30.1 (CLI)

- Asset `gitleaks_8.30.1_linux_x64.tar.gz`, SHA-256 `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`; the job verifies it with `sha256sum -c`.
- Command: `gitleaks git --redact --log-opts="--no-merges BASE..HEAD"`. It covers every commit in the PR, including secrets that a later commit deletes; they still live in `refs/pull/N/head`.
- `.gitleaks.toml` extends the default rules. Its only allowlist is the `generic-api-key` rule, on `packages/vault-crypto/test-vectors/*.json`, for 64-hex or longer values of the known vector keys, with path, rule and regex combined by `AND`. The values are deterministic public test vectors from the published spec.

Why not `gitleaks-action`:
- since v2 it is under a proprietary licence (personal accounts are free, organizations need a key);
- it needs `GITHUB_TOKEN` in env;
- it downloads the binary at runtime without a checksum.

The CLI avoids all three.

### 8. osv-scanner 2.6.0

- Asset `osv-scanner_linux_amd64`, SHA-256 `ca69b3d3cd08f889a49dc0a383122f71cc528b83803671df5fd874d97485b108`.
- It scans `pnpm-lock.yaml`, `tools/recover/uv.lock`, `.github/openspec-cli/package-lock.json` and `.github/scripts/package-lock.json` with `--config .github/osv-scanner.toml` and JSON output.

osv-scanner has no severity threshold, so `osv-gate.mjs`:
- fails on any vulnerability group with `max_severity` ≥ 7.0 or no score;
- prints medium and low findings;
- fails on scanner errors (exit codes other than 0 or 1).

It also lints the ignore file. Every `[[IgnoredVulns]]` entry needs an `id`, a non-empty `reason` and an `ignoreUntil` no more than 90 days ahead. Expiry itself is enforced by osv-scanner.

**Baseline triage (Assumption A2).** These advisories were all reached through `@dha-team/arbundles@1.0.4`:
- `GHSA-vjh7-7g9h-fjfh` (elliptic 6.5.4, CRITICAL 9.0);
- `GHSA-584q-6j8j-r5pm` (secp256k1 5.0.0, 8.7);
- `GHSA-3h5v-q93c-6h6q` and `GHSA-96hv-2xvq-fx4p` (ws 7.4.6, 8.7 and 7.5).

That package is a devDependency of `apps/web`, used only by `test/mirror/ans104.test.ts` as an oracle that signs fixed test data. It is not in the shipped bundle, no WebSocket provider is created, and secp256k1's native build is disabled (`onlyBuiltDependencies: []`). The CI engineer does not own `apps/web` or the root `package.json`.

The four advisories are therefore ignored until **2026-11-01**, with this reason. A follow-up for the web owner is raised: pnpm `overrides` to `elliptic>=6.6.1`, `secp256k1>=5.0.1` and `ws>=7.5.10`, or replace the oracle. The audit fails again on expiry.

The 7 MEDIUM findings are reported, not ignored.

### 9. Workflow policy script and zizmor

`workflow-policy.mjs` runs in `workflow-lint` and fails on:
- any `pull_request_target` trigger;
- workflow-level `permissions` missing or not exactly `contents: read`;
- any job without its own `permissions` or `timeout-minutes`;
- any `secrets.` reference in a workflow with a `pull_request` trigger;
- any `zizmor: ignore` comment;
- `.github/zizmor.yml` missing the `"*": hash-pin` policy or disabling a rule.

SHA pinning, `persist-credentials` (artipacked) and template injection stay with zizmor, so they are not duplicated. Hardening the zizmor config protects that delegation.

zizmor moves to `--persona=pedantic` (its strict persona). Every job and step gets a `name:`, which clears the only pedantic findings (`anonymous-definition`).

`workflow-lint` already runs on every push and on PRs that change `.github/**`, and it is in `ci-ok.needs`, so it gates.

### 10. Dependabot

Ecosystems:
- `npm` at `/` (the pnpm workspace; Dependabot reads `pnpm-lock.yaml`);
- `npm` at `/.github/openspec-cli` and `/.github/scripts`;
- `uv` at `/tools/recover`;
- `docker` at `/apps/web/deploy`, which bumps the Caddy tag and its digest;
- `github-actions`, as before.

Each is weekly with a 7-day cooldown and one group per ecosystem. Commit prefixes keep titles conventional: `chore(deps)`, plus `ci` for actions. No auto-merge workflow exists, and none is added.

## Threats / abuse (CI is security-relevant)

| Threat | Mitigation |
|---|---|
| Fork PR steals secrets or writes to the repo | `pull_request` only (enforced by the policy script); `contents: read`; no secrets; `persist-credentials: false`. |
| Injection via the PR title, body or labels | Passed only as `env:` values (`toJSON`); never interpolated into the shell. zizmor's template-injection audit stays on. |
| PR edits a gate script, `.gitleaks.toml` or the osv ignore file to pass itself | Inherent to `pull_request` CI. These files are in the diff, owned by CODEOWNERS, and require conversation resolution. The ignore-file lint limits each exception to 90 days with a stated reason. Accepted for a single-maintainer repo. |
| `no-spec` label as a blanket bypass | Only users with triage rights can label (not fork authors). It also requires a written justification that stays in the PR record. |
| A compromised scanner download | Version-pinned URL plus a committed SHA-256 check before execution. |
| A status spoofed by another app | `ci-ok` is bound to the GitHub Actions integration id. |
| Maintainer bypass | None configured; disabling the ruleset is audit-logged. |

## Risks / Trade-offs

- Strict "up to date" forces a rebase or update after every merge to `main`. This is cheap with a solo maintainer.
- Editing a title or body re-runs the full CI and costs Actions minutes (the Pro quota). It is accepted, since such edits are rare.
- osv-scanner queries `api.osv.dev` at run time, so it needs the network. An OSV outage fails the gate (fail closed); re-run the job.
- The gate scripts are trusted from the PR head (see the threat table).

## Migration Plan

1. Merge this change through a PR. Until the ruleset exists the gates run, but nothing forces them.
2. The overwatcher runs `.github/rulesets/apply.sh` (dry run), then `.github/rulesets/apply.sh --apply`.
3. The overwatcher creates the `no-spec` label.

Rollback: `gh api -X DELETE repos/prix0007/cryoshield/rulesets/<id>`, then revert the workflow.

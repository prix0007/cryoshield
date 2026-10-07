# ci-pipeline Specification

## Purpose
Define the automated checks that must pass on every push and pull request, and the supply-chain security posture of the CI system itself.

## Requirements

### Requirement: Per-area verification jobs
CI SHALL run a verification job for each code area when files in that area (or shared configuration it depends on) change: contracts, vault-crypto, recover, web, and openspec. A failing job MUST mark the run as failed.

#### Scenario: Contract change triggers contract checks
- **WHEN** a pull request modifies a file under `contracts/`
- **THEN** CI builds the contracts, runs the full Foundry test suite, and fails the run if any test fails

#### Scenario: Unrelated change skips area job
- **WHEN** a pull request modifies only files under `apps/web/`
- **THEN** the contracts job does not run its checks

#### Scenario: OpenSpec always validated
- **WHEN** any file under `openspec/` changes
- **THEN** CI runs strict validation of all changes and specs and fails on any invalid item

### Requirement: Contract gas and static-analysis gates
The contracts job MUST fail when gas usage diverges from the committed gas snapshot, and MUST run static analysis whose unresolved findings fail the run. Findings triaged as false positives MUST be suppressed only through a committed, reviewable configuration.

#### Scenario: Gas regression detected
- **WHEN** a change increases the gas cost of a snapshotted test relative to the committed snapshot
- **THEN** the contracts job fails until the snapshot is regenerated and committed

#### Scenario: New static-analysis finding
- **WHEN** static analysis reports a finding not covered by the committed triage configuration
- **THEN** the contracts job fails

### Requirement: Cross-implementation vector agreement
CI SHALL run the vault-crypto test vectors against both the TypeScript library and the Python recovery tool, on every supported Python version (3.10 and 3.12). Any disagreement MUST fail the run.

#### Scenario: Implementations disagree
- **WHEN** a change makes the recovery tool produce a different result from `packages/vault-crypto/test-vectors/` for any vector
- **THEN** the recover job fails on that Python version

### Requirement: Reproducible, locked installs
Every job SHALL install dependencies only from committed lockfiles and pinned toolchain versions, and MUST fail if a lockfile is missing or out of date.

#### Scenario: Lockfile drift
- **WHEN** a `package.json` or `pyproject.toml` changes without the corresponding lockfile update
- **THEN** the dependency install step fails

### Requirement: CI supply-chain security
Workflows MUST pin every third-party action to a full commit SHA, MUST default to read-only repository permissions, and MUST NOT expose repository secrets to workflows triggered by pull requests. Workflows MUST NOT use the `workflow_run` trigger, and MUST NOT use the `pull_request_target` or `issue_comment` triggers except in the two named privileged workflows (`ecc-review.yml`, `auto-merge.yml`). Every job MUST declare its own `permissions` and a `timeout-minutes`, and those permissions MUST be read-only except for the per-file write scopes allowed for the privileged workflows. A privileged workflow MUST:
- refuse fork pull requests before doing anything else;
- restrict comment-triggered jobs to the repository owner;
- never execute pull-request code;
- check out the pull-request head only in `ecc-review.yml`, and only for reading.

These rules MUST be enforced by a CI check that cannot be switched off by an inline suppression comment.

#### Scenario: Unpinned action rejected
- **WHEN** a workflow references a third-party action by tag or branch instead of a commit SHA
- **THEN** a CI lint check fails the run

#### Scenario: Pull request from a fork
- **WHEN** a pull request is opened from a fork
- **THEN** the workflows run with a read-only token and no access to repository secrets, and the privileged workflows refuse it

#### Scenario: Privileged PR trigger rejected
- **WHEN** a workflow other than `ecc-review.yml` or `auto-merge.yml` declares `pull_request_target` or `issue_comment`
- **THEN** the workflow policy check fails the run

#### Scenario: Privileged workflow loses a guard
- **WHEN** `ecc-review.yml` or `auto-merge.yml` drops its fork guard, runs a file from the checkout, checks out PR code where not allowed, or requests a write scope outside its allow-list
- **THEN** the workflow policy check fails and names the file and job

#### Scenario: Job without explicit permissions or timeout
- **WHEN** a workflow job omits `permissions` or `timeout-minutes`, or requests a write scope
- **THEN** the workflow policy check fails and names the job

#### Scenario: Secrets context in any form
- **WHEN** a PR-triggered workflow uses `secrets` inside an expression in any case or form (for example `toJSON(secrets)`)
- **THEN** the workflow policy check fails the run

#### Scenario: Lint suppression attempt
- **WHEN** a workflow contains an inline `zizmor: ignore` comment, or the zizmor configuration stops requiring hash pins for all actions
- **THEN** the workflow policy check fails the run

### Requirement: Pull request hardening gates
On every pull request, CI SHALL run a PR-only job that is required by the aggregate `ci-ok` check. The job MUST re-run when the title, description or labels change.

#### Scenario: PR job result gates ci-ok
- **WHEN** any PR-only gate fails
- **THEN** `ci-ok` fails and the pull request cannot merge

### Requirement: Conventional pull request titles
A pull request title MUST follow Conventional Commits (`type(scope)!: subject`), with type one of `feat`, `fix`, `docs`, `chore`, `ci`, `build`, `refactor`, `perf`, `test`, `style` or `revert`. The squash-merge commit on `main` takes this title.

#### Scenario: Non-conventional title
- **WHEN** a pull request is titled `Update stuff`
- **THEN** the title check fails and shows the expected format

#### Scenario: Conventional title
- **WHEN** a pull request is titled `fix(recover): handle empty log page`
- **THEN** the title check passes

### Requirement: Secret scanning of pull requests
CI MUST scan every commit in a pull request's range for secrets with a scanner pinned by version and checksum, and MUST fail on any finding. Allowlisted exceptions MUST be committed, limited to named public test-vector files and value shapes, and justified in the file.

#### Scenario: Leaked credential in a PR commit
- **WHEN** a commit in the pull request adds a private key or API token, even if a later commit removes it
- **THEN** the secret scan fails the run

#### Scenario: Public test vector
- **WHEN** a pull request edits a hex key field in `packages/vault-crypto/test-vectors/v1.json`
- **THEN** the secret scan does not report it

### Requirement: Dependency vulnerability audit
CI MUST audit every committed lockfile (pnpm, uv and the CI tool lockfiles) against the OSV database on every pull request, with a scanner pinned by version and checksum. The audit MUST fail on any HIGH or CRITICAL (CVSS ≥ 7.0) or unscored vulnerability. Exceptions MUST be listed in a committed ignore file, with a reason and an expiry date of no more than 90 days. The ignore file MUST be restricted to a syntax the lint and the scanner read identically.

#### Scenario: New high-severity vulnerability
- **WHEN** a lockfile resolves a package with a known CVSS 8.1 vulnerability that is not in the ignore file
- **THEN** the audit fails and names the package, version and advisory

#### Scenario: Medium-severity vulnerability
- **WHEN** the only findings have CVSS scores below 7.0
- **THEN** the audit reports them and passes

#### Scenario: Expired exception
- **WHEN** an ignore entry's expiry date has passed
- **THEN** the vulnerability counts again and fails the audit

### Requirement: Reusable full CI run
The CI workflow SHALL be callable by other workflows. When called with `full: true`, it MUST run every area job on the given commit regardless of path filters, and it MUST report failure if any job fails. A called run MUST NOT share a concurrency group with push or pull-request CI runs.

#### Scenario: Deploy pipeline calls CI
- **WHEN** the deploy pipeline calls CI with `full: true` on a `main` commit that changes only documentation
- **THEN** every area job (contracts, vault-crypto, recover, web, web-e2e, openspec, workflow-lint) still runs

### Requirement: Issue-triggered privileged workflow restrictions
The `issues` trigger SHALL be treated as privileged, because it runs with secrets for issues opened by anyone. Only `issue-triage.yml` may use it. In that workflow:
- every job MUST exclude pull requests and bots in its condition;
- a comment-triggered run MUST be restricted to the repository owner;
- checkouts MUST be of the default branch only, never PR code, without persisted credentials;
- run steps MUST be pinned by digest;
- the agent's tool lists MUST be exact;
- secrets other than `GITHUB_TOKEN` MUST appear only in the `diagnose` job.

This MUST be enforced by the workflow policy check.

#### Scenario: Another workflow on issues
- **WHEN** a workflow other than `issue-triage.yml` declares the `issues` trigger
- **THEN** the workflow policy check fails

#### Scenario: Triage checks out a PR
- **WHEN** `issue-triage.yml` gains a checkout with a `ref`
- **THEN** the workflow policy check fails

### Requirement: Review workspace holds no PR content at its root
The ECC review workflow (`pull_request_target`) SHALL:
- check out the base commit as the workspace root;
- check out the PR's head commit only into the subdirectory `pr/`, as data that is never executed;
- replace every agent-configuration file in `pr/` with the base commit's version, or remove it. This covers top-level and nested `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `.claude/` and `.mcp.json`, plus the top-level startup files.

A PR with a newline in any file path SHALL NOT be reviewed automatically. The reviewing agent SHALL be denied `pr/.git` as well as `.git`. The workflow policy check SHALL refuse:
- a PR-head checkout without `path: pr`;
- a base-commit checkout anywhere but the workspace root.

#### Scenario: PR head checked out at the root
- **WHEN** the PR-head checkout in `ecc-review.yml` has no `path`, or a path other than `pr`
- **THEN** the workflow policy check fails

#### Scenario: PR ships its own agent configuration
- **WHEN** a PR adds or changes `CLAUDE.md`, a nested `CLAUDE.md`, `.claude/` or `.mcp.json`
- **THEN** the reviewing agent sees the base commit's version of that file, or none

### Requirement: Triage comments escape agent text
The issue-triage comment composer SHALL HTML-escape every `<`, `>` and backtick in the agent's text, SHALL escape link-reference-definition syntax (`]:`), and SHALL break up marker names, before composing the comment. It SHALL NOT rely on a regex strip of comment syntax. No HTML comment, tag or triage marker can then appear in or be re-formed from the agent's part of the comment.

#### Scenario: Split delimiters
- **WHEN** the agent writes `<<!!-- x --<!>` or `<!-- x --!>`
- **THEN** the posted comment shows the characters as text, contains no `<!--`, `-->` or `--!>` in the agent's part, and counts no extra run marker

### Requirement: Unconfigured deploys skip without failing
Before the full CI, each deploy workflow SHALL check, in its build environment, that every required build variable and the `VITE_BUNDLER_URL` secret are non-empty: `deploy-dev.yml` checks `development-build`, and `deploy.yml` checks `production-build`. The check SHALL use presence flags only (`${{ vars.X != '' }}`, `${{ secrets.X != '' }}`), never the values.

If anything is missing:
- `deploy-dev.yml` (polled on every `main` commit) SHALL emit a `deploy not configured` warning that names the missing items and the environment and points to `docs/deploy.md`, in the log and the job summary. It SHALL skip every later job (CI, build, release) and conclude successfully, so `main` is never marked red.
- `deploy.yml` (an owner's release, or a dispatch at a release tag, always deliberate) SHALL emit the same message as an error, skip every later job, and **fail**.

Fully configured runs SHALL behave as before. The workflow policy SHALL allow a secret presence expression only for `VITE_BUNDLER_URL`, in the `config` step of a job in the workflow's own build environment.

#### Scenario: Nothing configured
- **WHEN** `deploy-dev.yml` runs and `development-build` has no variables or secrets
- **THEN** the run logs a warning naming every missing item and `development-build`, builds and deploys nothing, and concludes success

#### Scenario: Partly configured
- **WHEN** the owner publishes a release and only `VITE_BUNDLER_URL` is missing from `production-build`
- **THEN** the run reports an error naming `VITE_BUNDLER_URL`, builds and deploys nothing, and fails

#### Scenario: Configured later
- **WHEN** the configuration is completed after skipped dev runs
- **THEN** the next merge or a forced `workflow_dispatch` of `deploy-dev.yml` deploys normally, because skipped runs do not count as failed

#### Scenario: Fly token missing after approval
- **WHEN** a release job runs, after any required approval, with an empty `FLY_API_TOKEN` in its environment (`development` or `production`)
- **THEN** it fails at once with a `deploy not configured` error that names `FLY_API_TOKEN` and that environment, before calling flyctl

### Requirement: Deploy workflow restrictions per target
The workflow policy SHALL enforce, for each deploy workflow:

- **`deploy-dev.yml` (development):**
  - triggers only on `push` to `main`, `schedule` and `workflow_dispatch`;
  - its first job requires `github.ref == 'refs/heads/main'`;
  - it uses only environments `development` and `development-build`.
- **`deploy.yml` (production):**
  - triggers only on `release` with `types: [published]` and `workflow_dispatch` without inputs (the release tag is the run's own ref);
  - its first job requires `github.triggering_actor == github.repository_owner` and `startsWith(github.ref, 'refs/tags/v')`, for both events;
  - it has no workflow-level concurrency group (that group would be claimed before the owner gate);
  - it uses only environments `production` and `production-build`;
  - its release job re-checks the tag (`release-ref.sh`) before deploying.
- **Both:**
  - no `pull_request` or `pull_request_target` trigger;
  - a never-cancelled job-level release group (`deploy-development` or `deploy-production`); `deploy-dev.yml` also has an exact, never-cancelled per-commit workflow group;
  - exactly one job in the release environment, holding `FLY_API_TOKEN` only in the step env of steps `deploy` and `rollback`;
  - the bundler URL only in its build environment;
  - no write scopes;
  - no `always()`, `failure()` or `cancelled()`, in any letter case, in a job-level condition (they are allowed only in the step conditions of the rollback and fail-loudly steps);
  - every job that needs `config` requires `needs.config.outputs.configured == 'true'`;
  - the release job's re-check step runs immediately before the `deploy` step;
  - `deploy-dev.yml` never references `VITE_CF_BEACON_TOKEN`;
  - no `secrets: inherit`;
  - every run step of a token-holding job pinned by digest;
  - no build tooling in the release job.

No other workflow may reference `FLY_API_TOKEN` or use any of the four deploy environments; in particular only `deploy.yml` may use `production` or `production-build`.

#### Scenario: Production workflow on push
- **WHEN** `deploy.yml` gains a `push` or `schedule` trigger
- **THEN** the workflow policy check fails

#### Scenario: Cross-target environment
- **WHEN** a job in `deploy-dev.yml` uses environment `production`
- **THEN** the workflow policy check fails

#### Scenario: Release after a failed build
- **WHEN** a deploy workflow's release job condition becomes `always() && needs.detect.outputs.deploy == 'true'`
- **THEN** the workflow policy check fails

#### Scenario: Production from a branch
- **WHEN** `deploy.yml`'s first job accepts a dispatch from `refs/heads/main`, or the dispatch gains a `tag` input
- **THEN** the workflow policy check fails

#### Scenario: Owner gate removed
- **WHEN** the first job of `deploy.yml` drops the `github.triggering_actor == github.repository_owner` conjunct
- **THEN** the workflow policy check fails

### Requirement: Trusted-author gate enforced by the workflow policy
The workflow policy SHALL require the trusted-author gate in `ecc-review.yml` and `auto-merge.yml`.

In the `ecc-review` review job, the gate MUST:
- be the step directly after the fork refusal, before any credential, checkout or model step;
- have no condition;
- receive its inputs only through `env:` (author, sender, owner, event time, default branch, token);
- not override its working directory;
- fail the job (`exit 1`) for non-trusted authors.

In the `auto-merge` job, the gate MUST be the first step, and every later step MUST be conditioned on its `trusted` output.

The gate run steps MUST be pinned by digest like every other privileged run step. The policy SHALL also validate `.github/trusted-authors.json` as a JSON array of 1 to 20 unique GitHub logins, with no bot accounts and no wildcards.

#### Scenario: Gate removed or moved
- **WHEN** a change deletes the gate step from `ecc-review.yml`, moves it after a checkout, or adds an `if:` to it
- **THEN** the workflow policy fails and names the gate

#### Scenario: Auto-merge step unguarded
- **WHEN** a change removes `if: steps.author.outputs.trusted == 'true'` from the step that enables auto-merge
- **THEN** the workflow policy fails

#### Scenario: Invalid trusted-author entry
- **WHEN** `.github/trusted-authors.json` contains `dependabot[bot]`, `*`, a duplicate login or a non-string value
- **THEN** the workflow policy fails

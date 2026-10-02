# Spec Delta

## MODIFIED Requirements

### Requirement: CI supply-chain security
Workflows MUST pin every third-party action to a full commit SHA, MUST default to read-only repository permissions, and MUST NOT expose repository secrets to workflows triggered by pull requests. Workflows MUST NOT use the `pull_request_target` trigger, and every job MUST declare its own `permissions` and a `timeout-minutes`. These rules MUST be enforced by a CI check that cannot be switched off by an inline suppression comment.

#### Scenario: Unpinned action rejected
- **WHEN** a workflow references a third-party action by tag or branch instead of a commit SHA
- **THEN** a CI lint check fails the run

#### Scenario: Pull request from a fork
- **WHEN** a pull request is opened from a fork
- **THEN** the workflows run with a read-only token and no access to repository secrets

#### Scenario: Privileged PR trigger rejected
- **WHEN** a workflow file declares `pull_request_target`
- **THEN** the workflow policy check fails the run

#### Scenario: Job without explicit permissions or timeout
- **WHEN** a workflow job omits `permissions` or `timeout-minutes`
- **THEN** the workflow policy check fails and names the job

#### Scenario: Lint suppression attempt
- **WHEN** a workflow contains an inline `zizmor: ignore` comment, or the zizmor configuration stops requiring hash pins for all actions
- **THEN** the workflow policy check fails the run

## ADDED Requirements

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
CI MUST audit every committed lockfile (pnpm, uv and the CI tool lockfiles) against the OSV database on every pull request, with a scanner pinned by version and checksum. The audit MUST fail on any HIGH or CRITICAL (CVSS ≥ 7.0) or unscored vulnerability. Exceptions MUST be listed in a committed ignore file, with a reason and an expiry date of no more than 90 days.

#### Scenario: New high-severity vulnerability
- **WHEN** a lockfile resolves a package with a known CVSS 8.1 vulnerability that is not in the ignore file
- **THEN** the audit fails and names the package, version and advisory

#### Scenario: Medium-severity vulnerability
- **WHEN** the only findings have CVSS scores below 7.0
- **THEN** the audit reports them and passes

#### Scenario: Expired exception
- **WHEN** an ignore entry's expiry date has passed
- **THEN** the vulnerability counts again and fails the audit

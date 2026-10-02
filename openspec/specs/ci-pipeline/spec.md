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
Workflows MUST pin every third-party action to a full commit SHA, MUST default to read-only repository permissions, and MUST NOT expose repository secrets to workflows triggered by pull requests.

#### Scenario: Unpinned action rejected
- **WHEN** a workflow references a third-party action by tag or branch instead of a commit SHA
- **THEN** a CI lint check fails the run

#### Scenario: Pull request from a fork
- **WHEN** a pull request is opened from a fork
- **THEN** the workflows run with a read-only token and no access to repository secrets

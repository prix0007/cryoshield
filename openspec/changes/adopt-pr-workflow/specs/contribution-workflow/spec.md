# Spec Delta

## Purpose

Define how changes reach the `main` branch: protection rules kept as reviewable code, pull-request requirements, and the OpenSpec-first rule enforced on every pull request.

## ADDED Requirements

### Requirement: Main branch protection as code
The repository SHALL keep the `main` branch ruleset as a committed file in the GitHub ruleset API format, with a script that shows the difference from the live ruleset and applies it idempotently. The ruleset MUST require a pull request, conversation resolution, linear history, squash-only merges, and the `ci-ok` check up to date with `main`. It MUST block force-pushes and deletion, and grant no bypass.

#### Scenario: Direct push to main rejected
- **WHEN** anyone, the repository admin included, pushes a commit directly to `main`
- **THEN** GitHub rejects the push because a pull request is required

#### Scenario: Merge blocked until CI passes on current main
- **WHEN** a pull request's `ci-ok` check is failing, missing, or was computed against an outdated `main`
- **THEN** the pull request cannot be merged

#### Scenario: Re-applying an unchanged ruleset
- **WHEN** the apply script runs and the live ruleset already matches the committed file
- **THEN** it reports no difference and makes no write call

### Requirement: Pull request template and ownership
Every pull request SHALL be opened with a template that asks for the OpenSpec change name, the tests run, a security-review link or `N/A`, and screenshots for UI changes. A `CODEOWNERS` file SHALL assign every path to the maintainer.

#### Scenario: New pull request
- **WHEN** a contributor opens a pull request in the GitHub UI
- **THEN** the description is pre-filled with the OpenSpec, Tests, Security review and Screenshots sections

### Requirement: OpenSpec-first gate on pull requests
A pull request that changes code paths (`apps/`, `packages/`, `contracts/src/`, `tools/recover/src/`, `.github/workflows/`) MUST also add or modify a file under `openspec/changes/` (including `openspec/changes/archive/`), unless it carries the `no-spec` label and its description contains a non-empty `No-spec justification:` line. Otherwise CI MUST fail.

#### Scenario: Code change without a spec change
- **WHEN** a pull request modifies `apps/web/src/main.tsx` and nothing under `openspec/changes/`
- **THEN** the OpenSpec gate fails and names the code paths that need a change

#### Scenario: Code change with an OpenSpec change
- **WHEN** a pull request modifies `contracts/src/VaultRegistry.sol` and `openspec/changes/<name>/tasks.md`
- **THEN** the OpenSpec gate passes

#### Scenario: Justified exemption
- **WHEN** a pull request modifies only `packages/vault-crypto/src/x.ts`, carries the `no-spec` label, and its description contains `No-spec justification: typo in a log message`
- **THEN** the OpenSpec gate passes

#### Scenario: Label without justification
- **WHEN** a pull request carries the `no-spec` label but has no non-empty justification line
- **THEN** the OpenSpec gate fails

#### Scenario: Docs-only change
- **WHEN** a pull request modifies only `README.md` or files under `docs/`
- **THEN** the OpenSpec gate passes without a label

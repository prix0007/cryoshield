# Spec Delta

## MODIFIED Requirements

### Requirement: Pull request template and ownership
Every pull request SHALL be opened with a template that asks for:
- the OpenSpec change name;
- the tasks covered;
- verification, meaning the tests run;
- a security-review link or `N/A`;
- screenshots for UI changes;
- the review and merge process (ECC review, auto-merge, `hold`).

The template SHALL keep the `No-spec justification:` line. A `CODEOWNERS` file SHALL assign every path to the maintainer.

#### Scenario: New pull request
- **WHEN** a contributor opens a pull request in the GitHub UI
- **THEN** the description is pre-filled with the OpenSpec, Tasks covered, Verification, Security review, Screenshots and Review sections

## ADDED Requirements

### Requirement: Automatic ECC review of pull requests
Every non-draft pull request from a branch of this repository SHALL receive one automatic ECC review per head commit. The workflow MUST run from the base branch, refuse fork pull requests, and never execute pull-request code. The reviewing agent MUST have no shell and no GitHub access, and a workflow step MUST post its result as one review.

#### Scenario: Blocking finding
- **WHEN** a verified CRITICAL or HIGH finding stands for the head commit
- **THEN** the review is posted as "request changes" and the `ecc-review` check fails

#### Scenario: Clean re-review
- **WHEN** a later commit's review has no blocking findings
- **THEN** it is posted as a comment, earlier bot "request changes" reviews are dismissed, and the check passes

#### Scenario: Fork pull request
- **WHEN** a pull request comes from a fork
- **THEN** the first step fails the check before any checkout or secret use

#### Scenario: No reviewer credential
- **WHEN** neither `CLAUDE_CODE_OAUTH_TOKEN` nor `ANTHROPIC_API_KEY` is configured
- **THEN** the check fails, so it can never pass without a review

#### Scenario: Owner re-run
- **WHEN** the repository owner comments `/ecc-review` on a same-repo pull request
- **THEN** that PR's latest review run is re-run; comments from anyone else are ignored

### Requirement: Reviewer selection from changed paths
The review SHALL always include a general code reviewer and SHALL add reviewers based on the changed paths:
- `packages/vault-crypto/**`: security and TypeScript reviewers;
- `contracts/**`: a security reviewer;
- `apps/web/**`: React and TypeScript reviewers, plus a security reviewer for account, chain, WebAuthn, vault, mirror, deploy or CSP/header changes;
- `tools/recover/**`: Python and security reviewers;
- `.github/**` and `scripts/**`: a security reviewer.

When the pull request names an OpenSpec change, a deviation from that change MUST be reported as a finding.

#### Scenario: Crypto change
- **WHEN** a pull request changes `packages/vault-crypto/src/envelope.ts`
- **THEN** the code, security and TypeScript reviewers all review it

### Requirement: Auto-merge with an owner veto
Every non-draft, same-repository, non-Dependabot pull request into the default branch SHALL have GitHub auto-merge (squash, delete branch) enabled, but only while the default branch requires the `ecc-review` check. It then merges only when every required check passes. The `hold` label MUST switch auto-merge off, and removing it MUST switch it back on. The workflow MUST NOT check out code.

#### Scenario: Hold label
- **WHEN** the owner adds the `hold` label to an open pull request
- **THEN** auto-merge is disabled for it until the label is removed

#### Scenario: Failing check
- **WHEN** any required check fails or is missing
- **THEN** the pull request is not merged

#### Scenario: Review not yet required
- **WHEN** the default branch does not require `ecc-review`
- **THEN** auto-merge stays off, so no PR can merge before its review lands

#### Scenario: Dependabot pull request
- **WHEN** Dependabot opens a pull request
- **THEN** auto-merge is not enabled; the maintainer merges it

### Requirement: ECC review as an opt-in required check
The ruleset tooling SHALL be able to require the `ecc-review` check in addition to `ci-ok`, only when explicitly asked to. The default ruleset MUST NOT require it while no reviewer credential exists.

#### Scenario: Default apply
- **WHEN** the admin runs the ruleset apply script without the ECC flag
- **THEN** only `ci-ok` is required

#### Scenario: ECC review enabled
- **WHEN** the admin runs the apply script with `--with-ecc-review --apply`
- **THEN** both `ci-ok` and `ecc-review` are required checks on `main`

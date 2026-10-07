# contribution-workflow Specification

## Purpose
Define how changes reach the `main` branch: protection rules kept as reviewable code, pull-request requirements, and the OpenSpec-first rule enforced on every pull request.

## Requirements

### Requirement: Main branch protection as code
The repository SHALL keep the `main` branch ruleset as a committed file in the GitHub ruleset API format, with a script that shows the difference from the live ruleset and applies it idempotently. The ruleset MUST require a pull request, conversation resolution, linear history, squash-only merges, and the required status checks (`ci-ok`, plus `ecc-review` once enabled) passing on the pull request's head commit. It MUST NOT require the branch to be up to date with `main`, so that auto-merge does not stall when another pull request merges first. Each `main` commit is re-verified by the deploy pipeline's full CI before deployment. The ruleset MUST block force-pushes and deletion, and grant no bypass.

#### Scenario: Direct push to main rejected
- **WHEN** anyone, the repository admin included, pushes a commit directly to `main`
- **THEN** GitHub rejects the push because a pull request is required

#### Scenario: Merge blocked until CI passes on current main
- **WHEN** a pull request's required checks are failing or missing on its head commit (whether or not that commit includes the latest `main`)
- **THEN** the pull request cannot be merged

#### Scenario: Another pull request merged first
- **WHEN** a pull request's required checks passed and `main` has since moved because another pull request merged
- **THEN** the pull request still auto-merges without needing a rebase, and the resulting `main` commit runs the full CI in the deploy pipeline before anything is deployed

#### Scenario: Re-applying an unchanged ruleset
- **WHEN** the apply script runs and the live ruleset already matches the committed file
- **THEN** it reports no difference and makes no write call

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

### Requirement: OpenSpec-first gate on pull requests
A pull request that changes code paths (`apps/`, `packages/`, `contracts/src/`, `tools/recover/src/`, `.github/`, `scripts/`, `.gitleaks.toml`, root workspace manifests, `contracts/foundry.toml`) MUST also add or modify a file under `openspec/changes/` (archive included), unless it has the `no-spec` label and a non-empty `No-spec justification:` line. Otherwise CI MUST fail, also when a changed path cannot be read unambiguously.

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

#### Scenario: Change to the gates themselves
- **WHEN** a pull request modifies only `.github/scripts/openspec-gate.mjs` or `.github/osv-scanner.toml`
- **THEN** the OpenSpec gate requires an OpenSpec change (or a justified `no-spec` label)

#### Scenario: Non-ASCII code path
- **WHEN** a pull request adds `contracts/src/Évil.sol` without an OpenSpec change
- **THEN** the OpenSpec gate fails

#### Scenario: Docs-only change
- **WHEN** a pull request modifies only `README.md` or files under `docs/`
- **THEN** the OpenSpec gate passes without a label

### Requirement: Automatic ECC review of pull requests
Every non-draft pull request from a branch of this repository SHALL get an ECC review per head commit. The review SHALL start automatically only when both the pull request's author and the account that triggered the event (the pusher) are trusted. An account is trusted when it is the repository owner or is listed in `.github/trusted-authors.json` as read from the default branch.

Otherwise, the `ecc-review` check MUST fail before any reviewer credential is used, any code is checked out or any model is called, and the failure message MUST say that the check is awaiting owner approval. A skipped check MUST NOT be used for this.

The check MUST pass this gate only when the repository owner has commented `/ecc-review <sha>` on the pull request, where:
- `<sha>` is 7 to 40 hex characters of the run's head commit;
- the comment was made after the event that started the run and has not been edited;
- there is one such comment per re-run attempt.

The workflow MUST:
- run from the base branch;
- refuse fork pull requests;
- never execute pull-request code.

The reviewing agent MUST have no shell and no GitHub access, and a workflow step MUST post its result as one review.

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

#### Scenario: Trusted author
- **WHEN** the repository owner, or an account listed in `.github/trusted-authors.json` on the default branch, pushes to a same-repo pull request opened by a trusted author
- **THEN** the ECC review runs automatically for the new head commit

#### Scenario: Non-trusted author awaits the owner
- **WHEN** an account that is neither the owner nor listed (including Dependabot) opens or pushes to a same-repo pull request
- **THEN** the `ecc-review` check fails at once with "Awaiting owner approval", before the credential check, any checkout or any model call

#### Scenario: Owner approves a commit
- **WHEN** the repository owner comments `/ecc-review abcdef1` on that pull request after the push of head commit `abcdef1…`
- **THEN** the latest review run is re-run, the gate finds the unedited owner comment naming that commit and newer than the run's event, and the review runs

#### Scenario: Non-trusted push to a trusted author's pull request
- **WHEN** an account that is not trusted pushes a commit to a pull request opened by the owner
- **THEN** the `ecc-review` check fails with "Awaiting owner approval" and auto-merge is switched off

#### Scenario: Approval replayed onto another commit or re-run
- **WHEN** an approval names commit Y, and someone re-runs the run for commit X, or re-runs the approved run again from the Actions UI
- **THEN** the gate fails, because the approval names another commit, or because the attempt has no approval of its own

#### Scenario: Approval does not carry over to a new push
- **WHEN** the non-trusted author pushes another commit after the owner's approval
- **THEN** the new run fails with "Awaiting owner approval" until the owner approves the new head commit

#### Scenario: Forged approval
- **WHEN** anyone other than the owner:
  - comments `/ecc-review <sha>`;
  - edits an owner comment to read `/ecc-review <sha>`;
  - re-runs the failed run from the Actions UI; or
  - adds their login to the pull request's copy of `.github/trusted-authors.json`
- **THEN** the gate still fails

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
Every non-draft, same-repository pull request into the default branch whose author, and whose latest event's sender, are trusted SHALL have GitHub auto-merge (squash, delete branch) turned on, but only while the default branch requires the `ecc-review` check. It then merges only when every required check passes. The trusted authors are those of "Automatic ECC review of pull requests".

Every push MUST re-check this. For any other author or sender (Dependabot included), auto-merge MUST be switched off, and the owner merges by hand after review. The `hold` label MUST switch auto-merge off, and removing it MUST switch it back on. The workflow MUST NOT check out code.

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

#### Scenario: Non-trusted author
- **WHEN** a same-repo pull request is opened by an account that is neither the owner nor listed in `.github/trusted-authors.json` on the default branch
- **THEN** the workflow switches auto-merge off for it and reports that the owner merges it after review

#### Scenario: Trusted-author list unreadable
- **WHEN** `.github/trusted-authors.json` is missing on the default branch, is not a JSON array, or cannot be read
- **THEN** auto-merge is not enabled for a non-owner author

### Requirement: ECC review as an opt-in required check
The ruleset tooling SHALL be able to require the `ecc-review` check in addition to `ci-ok`, only when explicitly asked to. The default ruleset MUST NOT require it while no reviewer credential exists.

#### Scenario: Default apply
- **WHEN** the admin runs the ruleset apply script without the ECC flag
- **THEN** only `ci-ok` is required

#### Scenario: ECC review enabled
- **WHEN** the admin runs the apply script with `--with-ecc-review --apply`
- **THEN** both `ci-ok` and `ecc-review` are required checks on `main`

### Requirement: Agents act through a non-admin machine account
Automated agents SHALL push branches, open pull requests and comment as a dedicated machine account. That account SHALL have the Write role and a fine-grained token scoped to this repository, without administration permission. The owner's admin credentials SHALL NOT be used by agents, so rulesets and environment approvals bind them.

#### Scenario: Agent tries to change protection
- **WHEN** an agent using the machine account calls the rulesets or environments API to change protection
- **THEN** GitHub refuses the call for lack of administration permission

### Requirement: Fork pull request workflow approval as code
The repository's fork pull request workflow approval policy SHALL be `all_external_contributors`. It SHALL be kept as a committed file and synced by the ruleset apply script. The script MUST show the difference in a dry run without writing, and MUST write it only with `--apply`.

#### Scenario: Fork contributor opens a pull request
- **WHEN** an external contributor opens a pull request from a fork, whether or not they contributed before
- **THEN** no workflow runs for it until a maintainer approves the run

#### Scenario: Drifted approval policy
- **WHEN** the live policy is `first_time_contributors` and the admin runs the apply script without `--apply`
- **THEN** the script shows the difference, makes no write call and exits with the drift status

#### Scenario: Applying the policy
- **WHEN** the admin runs the apply script with `--apply` and the live policy differs
- **THEN** the script sends the committed policy to `actions/permissions/fork-pr-contributor-approval` and re-checks that it is in sync

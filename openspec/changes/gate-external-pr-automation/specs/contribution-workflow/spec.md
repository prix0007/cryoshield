# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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

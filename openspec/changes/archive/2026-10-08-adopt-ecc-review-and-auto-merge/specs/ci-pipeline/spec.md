# Spec Delta

## MODIFIED Requirements

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

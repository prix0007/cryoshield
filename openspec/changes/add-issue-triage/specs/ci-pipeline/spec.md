# Spec Delta

## ADDED Requirements

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

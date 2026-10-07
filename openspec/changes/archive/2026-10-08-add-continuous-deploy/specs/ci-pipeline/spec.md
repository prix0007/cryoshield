# Spec Delta

## ADDED Requirements

### Requirement: Reusable full CI run
The CI workflow SHALL be callable by other workflows. When called with `full: true`, it MUST run every area job on the given commit regardless of path filters, and it MUST report failure if any job fails. A called run MUST NOT share a concurrency group with push or pull-request CI runs.

#### Scenario: Deploy pipeline calls CI
- **WHEN** the deploy pipeline calls CI with `full: true` on a `main` commit that changes only documentation
- **THEN** every area job (contracts, vault-crypto, recover, web, web-e2e, openspec, workflow-lint) still runs

### Requirement: Deployment workflow restrictions
The workflow policy SHALL enforce the following for `deploy.yml`:
- it has no `pull_request` or `pull_request_target` trigger;
- every job that uses a non-`GITHUB_TOKEN` secret runs in environment `production`;
- `FLY_API_TOKEN` appears only in step-level env of steps with id `deploy` or `rollback`;
- it never passes `secrets: inherit`.

No other workflow may reference `FLY_API_TOKEN` or environment `production`.

#### Scenario: PR trigger added to deploy
- **WHEN** `deploy.yml` gains a `pull_request` trigger
- **THEN** the workflow policy check fails

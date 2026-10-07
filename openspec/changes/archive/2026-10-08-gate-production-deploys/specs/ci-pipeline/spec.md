# Spec Delta

## ADDED Requirements

### Requirement: Deploy environment policy
The workflow policy check SHALL enforce, for `deploy.yml`:
- every job referencing `FLY_API_TOKEN` uses environment `production`, and every `production` job references it;
- at most one job uses `production`;
- `production-build` jobs never reference the token;
- the `production` job has a job-level concurrency group `deploy-production` that is never cancelled;
- only the `supersede` job may request `actions: write`.

No other workflow may use either environment.

#### Scenario: Second production job
- **WHEN** a second job in `deploy.yml` uses environment `production`
- **THEN** the workflow policy check fails (it would need a second approval)

# Spec Delta

## ADDED Requirements

### Requirement: Unconfigured deploys skip without failing
Before the full CI, the Deploy workflow SHALL check in environment `production-build` that every required build variable and the `VITE_BUNDLER_URL` secret are non-empty. The check SHALL use presence flags only (`${{ vars.X != '' }}`, `${{ secrets.X != '' }}`), never the values.

If anything is missing, the workflow SHALL:
- emit a `deploy not configured` warning that names the missing items and points to `docs/deploy.md`, in the log and the job summary;
- skip every later job (CI, build, supersede, release);
- conclude successfully.

Fully configured runs SHALL behave as before. The workflow policy SHALL allow a secret presence expression only for `VITE_BUNDLER_URL`, in the `config` step of a `production-build` job.

#### Scenario: Nothing configured
- **WHEN** the Deploy workflow runs and `production-build` has no variables or secrets
- **THEN** the run logs a warning naming every missing item, builds and deploys nothing, and concludes success

#### Scenario: Partly configured
- **WHEN** only `VITE_BUNDLER_URL` is missing
- **THEN** the run warns naming `VITE_BUNDLER_URL`, skips the rest, and concludes success

#### Scenario: Configured later
- **WHEN** the configuration is completed after skipped runs
- **THEN** the next merge or a forced `workflow_dispatch` deploys normally, because skipped runs do not count as failed

#### Scenario: Fly token missing after approval
- **WHEN** an approved release runs with an empty `FLY_API_TOKEN`
- **THEN** it fails at once with a `deploy not configured` error that names `FLY_API_TOKEN`, before calling flyctl

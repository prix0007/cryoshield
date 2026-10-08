# Spec Delta

## ADDED Requirements

### Requirement: Deploy context verified against build job outputs
The workflow policy SHALL enforce, for `deploy.yml` and `deploy-dev.yml`:
- the `build` job has a step with id `context-hash` that runs `.github/scripts/deploy/verify-context.sh` with `ROLE: build`, and the job declares outputs `tree_hash` and `caddyfile_hash` taken from that step;
- the release job has a step with id `verify-context` that runs the same script with `ROLE: release`, `EXPECT_TREE_HASH: ${{ needs.build.outputs.tree_hash }}` and `EXPECT_CADDYFILE_HASH: ${{ needs.build.outputs.caddyfile_hash }}` in its step env, before the re-check and `deploy` steps;
- the release job's `smoke` step passes `EXPECT_TREE_HASH: ${{ needs.build.outputs.tree_hash }}`.

#### Scenario: Cross-job check removed
- **WHEN** the release job's `verify-context` step loses its `EXPECT_TREE_HASH` env, or the build job loses its `tree_hash` output
- **THEN** the workflow policy check fails

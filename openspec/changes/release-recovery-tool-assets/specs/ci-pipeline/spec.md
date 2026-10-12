# Spec Delta

## ADDED Requirements

### Requirement: Release asset workflow restrictions
The workflow that attaches recovery-tool files to a release (`recover-release.yml`) SHALL run only on a published release (`release` with `types: [published]`) or an input-less `workflow_dispatch` dry run, and its first job SHALL run only when the triggering actor is the repository owner and either the event is the release at a `v*` tag or the dispatch at `main`; a release tag SHALL be checked to point at the release commit and to be reachable from `main`. Files SHALL be uploaded only for the release event; a dry run SHALL keep them as a workflow artifact. Exactly one job (`publish`) MAY hold write scopes, exactly `contents: write`, `id-token: write` and `attestations: write`; every other job SHALL hold exactly `contents: read`, and only the gate job (`detect`) and `publish` MAY reference the job token. The publish job SHALL use only SHA-pinned `actions/checkout`, `actions/download-artifact` and `actions/attest-build-provenance`, SHALL run no build tooling, and its run steps SHALL be digest-pinned after review. The workflow SHALL NOT reference secrets or environments, SHALL NOT create, edit or delete releases or tags, and SHALL NOT replace an existing release asset. The workflow policy check SHALL enforce all of this.

#### Scenario: Non-owner publishes a release
- **WHEN** a release is published by anyone other than the repository owner
- **THEN** the first job is skipped and nothing is built or uploaded

#### Scenario: Owner dry run on main
- **WHEN** the owner dispatches the workflow on `main`
- **THEN** every platform is built and smoke-tested, and the files with their checksums are kept as a workflow artifact; nothing is uploaded to any release

#### Scenario: Write scope outside the publish job
- **WHEN** a job other than `publish` in `recover-release.yml` requests a write scope, or the publish job requests any other scope
- **THEN** the workflow policy check fails and names the job

#### Scenario: Asset replacement or release mutation
- **WHEN** a run step in `recover-release.yml` uses `--clobber`, `gh release create`, `gh release edit`, `gh release delete`, `gh release delete-asset`, `git tag` or `git push`
- **THEN** the workflow policy check fails

#### Scenario: Token in a build job
- **WHEN** a build job of `recover-release.yml` references `github.token`
- **THEN** the workflow policy check fails

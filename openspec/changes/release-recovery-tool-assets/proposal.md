# Proposal: attach the recovery tool to every CryoShield release

## Why

The recovery tool is how a user opens their vault if cryoshield.app is gone. Today it has no real download:

- `cryoshield-recover` is not on PyPI (the PyPI API returns 404), yet the README and `launch-op-mainnet` task 7.4 tell
  users to run `uvx cryoshield-recover` and `pipx install cryoshield-recover`. Both fail.
- The README says "a single-file binary from the releases page", but no release has ever carried one.
- The project cannot simply publish a separate release for the tool: publishing **any** GitHub Release starts
  `deploy.yml` (a `v*` tool release would deploy production; any other tag fails its gate).

The founder decided on 2026-10-12 to attach the tool to the CryoShield release itself, "downloadable from release like
in rhizomon case": per-platform files with fixed names, so `releases/latest/download/<file>` links never change, plus
checksums.

## What Changes

- **New workflow `.github/workflows/recover-release.yml`.** When the owner publishes a `v*` release (the same event
  that deploys production), it builds the recovery tool from the tagged commit and **uploads** the files to that same
  release. It never creates, edits or deletes a release or tag, and never replaces an asset that is already there.
  - Same gate as `deploy.yml`: only the repository owner, only a `v*` tag, and the tag must point at the release's
    commit and be reachable from `main` (`release-ref.sh`).
  - Read-only build jobs; one `publish` job holds `contents: write` (upload), `id-token: write` and
    `attestations: write` (build provenance). It checks out nothing but its own scripts and runs no build tooling.
- **Assets** (fixed names, so the "latest" links are stable):
  - `cryoshield-recover-linux-x86_64`, `cryoshield-recover-linux-arm64` (built in the pinned, reproducible Docker
    image), `cryoshield-recover-macos-arm64`, `cryoshield-recover-macos-x86_64`,
    `cryoshield-recover-windows-x86_64.exe`;
  - the Python wheel and source archive under their standard names (`cryoshield_recover-<version>-…`), because
    `pip`/`pipx` refuse a wheel whose file name does not follow the standard;
  - a `.sha256` file per asset and one `SHA256SUMS`, computed by the publish job from the bytes it uploads;
  - a signed build-provenance attestation for every asset (`gh attestation verify`).
- **Owner dry run.** `gh workflow run recover-release.yml --ref main` (owner only) builds and smoke-tests every
  platform and keeps the files and checksums as a workflow artifact, so release day is not the first run. Nothing is
  uploaded to a release.
- **Version = tag.** The founder chose `v1.0.0` for the first production release; `tools/recover` moves to `1.0.0`,
  and a release whose tag differs from the tool's version gets no files.
- **Release guard.** The workflow runs the tool's existing `release` test (`pytest -m release --run-release`): no
  assets are published if the default network has no registry.
- **Workflow policy.** `workflow-policy.mjs` gets a `RELEASE_ASSETS` profile that pins all of the above (trigger,
  gate, per-job permissions, allowed actions, token scope, digest-pinned publish steps, no `--clobber`, no
  release/tag writes) and keeps every other workflow read-only.
- **Docs.** `tools/recover/README.md` gets a Download section with the fixed links and how to verify a file
  (checksum, attestation, and honest notes on unsigned binaries and macOS/Windows warnings), and stops promising PyPI.
  The launch checklist (step 3.2) and `launch-op-mainnet` task 7.4 describe the new procedure.
- `scripts/build-binary.sh` finds PyInstaller on Windows (`venv\Scripts`).

## Capabilities

### Modified Capabilities

- `vault-recovery`: "Installable and reproducible distribution" no longer claims PyPI; it requires release downloads
  with checksums and provenance.
- `ci-pipeline`: a new requirement for the release-asset workflow's restrictions.

## Impact

- New: `.github/workflows/recover-release.yml` (owner pushes it: the agent token has no Workflows permission),
  `.github/scripts/recover-release.mjs` and its tests.
- Changed: `.github/scripts/workflow-policy.mjs`, `.github/scripts/privileged-run-steps.json`, workflow-policy tests,
  `tools/recover/scripts/build-binary.sh`, `tools/recover/README.md`, `docs/launch/mainnet-release-checklist.md`,
  `openspec/changes/launch-op-mainnet/tasks.md`.
- No change to the web app, contracts, vault format or `deploy.yml`. A failed asset build never affects the production
  deploy (separate workflow).
- Not done (founder decisions, see design.md): code signing of the macOS and Windows binaries; publishing to PyPI.

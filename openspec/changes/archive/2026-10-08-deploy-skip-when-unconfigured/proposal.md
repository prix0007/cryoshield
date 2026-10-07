# Proposal

## Why

`main` shows red because every Deploy run fails in `build` with "missing environment variables/secrets: VITE_BUNDLER_URL". Examples are runs 37235476161 and 37215040828, on push and on schedule. The founder hasn't set up the `production-build` environment yet. A missing configuration is a setup state, not a broken commit, so it shouldn't fail `main`, and it shouldn't run the full CI every 15 minutes for nothing.

## What Changes

- **New `config` job in `deploy.yml`:** it needs `detect`, runs in environment `production-build`, and runs before the full CI. Its step env gets presence flags only (`${{ vars.X != '' }}`, and `${{ secrets.VITE_BUNDLER_URL != '' }}`). New script `.github/scripts/deploy/check-config.sh` reads them and outputs `configured=true|false`.
  - If anything is missing, partial setups included, it emits `::warning title=deploy not configured::`, names the items, points to `docs/deploy.md`, and writes the job summary.
  - A missing or malformed flag is a workflow bug, so it fails loudly instead.
- **`test` and `build`** now also need `config` and run only when `configured == 'true'`. `supersede` and `release` depend on `build`, so they skip too. The run concludes success.
- **"Previously failed" detection is unchanged:** it counts only `failure` runs, so skipped runs never block a later deploy.
- **`FLY_API_TOKEN` stays behind the approval.** `previous-image.sh`, the first command after approval, now fails at once with a `deploy not configured` error if the token is empty.
- **`workflow-policy.mjs`:** allows `secrets.VITE_BUNDLER_URL != ''` only in step `config` of a `production-build` job. Every other secret expression rule is unchanged.
- **`docs/deploy.md`:** describes the "not configured" behaviour.
- **Runtime dependencies: none.**

**Note:** this changes a workflow, so GitHub does not let the auto-merge bot merge it. The overwatcher merges it by hand once it is green.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `ci-pipeline`: unconfigured deploys skip without failing.

## Impact

`.github/workflows/deploy.yml`, `.github/scripts/deploy/check-config.sh` (new), `.github/scripts/deploy/previous-image.sh`, `.github/scripts/workflow-policy.mjs`, `.github/zizmor.yml` (the line pin moved), tests and `docs/deploy.md`.

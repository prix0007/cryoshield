# Proposal: Run desktop and phone E2E in parallel

## Why

`add-mobile-e2e` added the `mobile` and `mobile-small` Playwright projects. The single `web-e2e` job went from about
5 minutes to 11.5 minutes (PR #78), and every PR, every dev deploy and every release waits for it. The founder
(2026-10-09) chose to split the job so the two halves run side by side, with the same coverage.

## What Changes

- `web-e2e` in `.github/workflows/ci.yml` becomes a two-entry matrix (`fail-fast: false`):
  - `desktop` runs the `chromium` and `analytics` projects;
  - `mobile` runs the `mobile` and `mobile-small` projects.
- `apps/web/playwright.config.ts` starts the analytics preview server (port 4174) only when the `analytics` project
  can run, so the phone shard does not spend a build on it. With no `--project` filter, nothing changes locally.
- `ci-ok` still needs `web-e2e`; a matrix job reports failure if either entry fails.

## Out of scope

- Fewer specs, sharding inside a project, or any change to what the specs check.
- Ruleset changes: the only required check stays `ci-ok`.

## Impact

- `.github/workflows/ci.yml`, `apps/web/playwright.config.ts`, `apps/web/e2e/README.md`.
- The deploy pipelines reuse `ci.yml`, so dev and production builds get the same speed-up.
- **Runtime dependencies:** none. No CryoShield-operated backend.

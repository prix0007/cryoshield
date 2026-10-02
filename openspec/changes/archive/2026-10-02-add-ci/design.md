# Design

## Context

Monorepo with pnpm workspace (`packages/*`, `apps/*`), Foundry project in `contracts/` (forge-std vendored without git, committed gas snapshots in `contracts/snapshots/`), and a planned uv-managed Python tool in `tools/recover/`. No CI exists. The project is open source and will receive external pull requests, so the CI itself is an attack surface.

## Goals / Non-Goals

**Goals:**
- Fast, path-filtered feedback per area; one required aggregate status for branch protection.
- Treat CI as security-relevant: pinned, least-privilege, secret-free on PRs.

**Non-Goals:**
- Deployments, releases, binary signing, Playwright E2E (later change).
- Self-hosted runners.

## Decisions

1. **One workflow, path-filtered jobs, plus an aggregate `ci-ok` job.** A `changes` job uses a SHA-pinned path-filter action to emit booleans; area jobs run conditionally; `ci-ok` depends on all and treats skipped as success. Branch protection requires only `ci-ok`. *Alternative:* one workflow per area with `on.paths` — rejected because skipped workflows never report, which blocks required checks.
2. **Toolchain pinning.** Foundry via `foundry-rs/foundry-toolchain` pinned by SHA with `version: v1.1.0`; Node 22 + pnpm 9.15.5 (from `packageManager`); uv pinned version with Python matrix 3.10/3.12. *Alternative:* `stable`/`latest` — rejected, nondeterministic.
3. **Locked installs.** `pnpm install --frozen-lockfile`; `uv sync --locked`; `forge build` uses vendored `lib/` (no network fetch).
4. **Slither.** Run via `uvx --from slither-analyzer==0.11.6`; false positives (e.g. the triaged uninitialized-storage finding on the locator index) suppressed through a committed `contracts/slither.config.json` / inline `// slither-disable-next-line` with a comment linking the design.md triage. *Alternative:* crytic action — fine too, but uvx keeps the version pin explicit.
5. **Gas gate.** `forge snapshot --check` against the committed snapshot (matching what add-vault-registry-contract task 7.1 validated locally, `--mc GasTest`).
6. **Cross-implementation vectors.** The recover job reads `packages/vault-crypto/test-vectors/*.json` directly from the checkout; its path filter includes `packages/vault-crypto/test-vectors/**` so vector changes re-run Python.
7. **Hardening.** Top-level `permissions: contents: read`; triggers `push` (main) and `pull_request` only — never `pull_request_target`; no `secrets.*` references; `persist-credentials: false` on checkout; an `actionlint` + pinned-SHA check step (e.g. a small script or `zizmor`) in the `openspec`/meta job; concurrency group cancels superseded runs.

## Risks / Trade-offs

- [SHA pins go stale] → Dependabot for `github-actions` ecosystem (config only, no secrets).
- [Path filters miss a shared dependency] → filters include root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and each area's lockfile; `ci-ok` runs on every event.
- [Invariant/fuzz runtime ~40 s+] → acceptable; can add a `ci` Foundry profile with fewer runs if it grows.
- [`recover`/`web` directories don't exist yet] → jobs no-op until their changes land; tasks verify them when they do.

## Migration Plan

Add workflow; push to a branch; confirm all jobs green; enable branch protection requiring `ci-ok` (manual repo setting, documented in README). Rollback: delete the workflow file.

## Implementation notes (assumptions, recorded during apply)

These are labelled assumptions made while implementing; the overwatcher may revise them.

- **Assumption A1: Slither triage lives in `.github/slither-triage.json`.** The CI engineer does not own `contracts/`, so decision 4's `contracts/slither.config.json` / inline `slither-disable` could not be added. Slither's `--triage-database` reads that file and hides only findings whose `id` matches (the id hashes the finding description, including line numbers), so any edit to the flagged code resurfaces the finding for re-triage. Each entry links to the add-vault-registry-contract design.md triage. Slither runs with `--filter-paths "lib/|test/|script/"`, the same as the triage run. Moving the suppression inline later only needs the contracts owner's change and deleting this file.
- **Assumption A2: push to `main` runs every area job.** The path filter (`dorny/paths-filter`) runs only on `pull_request`, where it reads changed files from the API without a checkout (job permission `pull-requests: read`). On `push` the area jobs ignore the filter. Main is then always fully verified, and no git fetch with credentials is needed.
- **Assumption A3: E2E is in scope after all.** The overwatcher asked for a separate `web-e2e` job (Playwright Chromium + anvil). It supersedes the proposal's "Playwright E2E out of scope". The `web` job also runs `test:int` (anvil) and `verify-build`. Both web jobs install Foundry 1.1.0 and run `forge build`, because the local chain stack deploys `contracts/out`.
- **Assumption A4: the vault-crypto job also runs `test:browser`**, the same suite in headless Chromium, as well as `test`.
- **Assumption A5: the recover job installs Foundry**, so `tests/test_anvil_e2e.py` runs instead of auto-skipping. Lint and type checks follow `tools/recover/README.md`: `ruff check src tests` and `mypy`, which is strict and covers `src` per pyproject. `mypy --strict .` errors on `tests/support/vectors.py` being found under two module names. The path filter includes `contracts/src/**`, because the anvil test builds the registry.
- **Assumption A6: the OpenSpec CLI is installed from a committed lockfile** (`.github/openspec-cli/package-lock.json`, `npm ci --ignore-scripts`) instead of an ad-hoc `npm install -g`. This keeps integrity hashes and passes zizmor's `adhoc-packages` audit. The job asserts the version is 1.14.0.
- **Assumption A7: no dependency caches** in any job. They are a cache-poisoning surface on PRs, and runtime is acceptable without them.
- **Assumption A8: lint tools are run without extra actions.** actionlint runs from its Docker image pinned by digest (`rhysd/actionlint:1.7.12@sha256:…`). zizmor runs via `uvx zizmor==1.30.1 --offline` with `.github/zizmor.yml`, which requires a hash pin for every action, first-party ones included.

## Security review follow-up (2026-10-02)

The review returned APPROVE with one MEDIUM: `forge test` silently rewrites the per-call gas snapshots in `contracts/snapshots/`, so a per-call regression could pass. Fixed by adding a `Per-call gas snapshot check` step (`git diff --exit-code -- snapshots/`) after `forge snapshot --check`; it was verified clean locally and passes actionlint.

LOWs accepted for the MVP:
- mypy covers `src` only;
- Node and Python are pinned to a version line, not a patch release;
- Playwright and Foundry downloads are not hash-checked;
- Dependabot covers GitHub Actions only.

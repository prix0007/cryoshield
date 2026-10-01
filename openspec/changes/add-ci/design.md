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

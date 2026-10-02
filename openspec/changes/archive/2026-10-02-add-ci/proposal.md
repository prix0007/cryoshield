# Proposal

## Why

CryoShield ships without an external audit, so automated regression gates are a primary safety net. Today nothing runs tests, gas checks, Slither, or OpenSpec validation on push or pull request; add-vault-registry-contract task 7.1 ("gas snapshot passes in CI") cannot be closed until CI exists.

## What Changes

- Add GitHub Actions CI with one job per area, each gated by path filters:
  - `contracts`: forge 1.1.0 build, test, `forge snapshot --check`, Slither.
  - `vault-crypto`: pnpm 9, Node 22, package tests.
  - `recover`: uv on Python 3.10 and 3.12, pytest incl. cross-implementation test vectors.
  - `web`: lint, typecheck, unit tests.
  - `openspec`: `openspec validate --all --strict`.
- Supply-chain hardening: actions pinned by commit SHA, `permissions: contents: read`, no secrets exposed to pull-request runs, installs fail on lockfile drift.
- No new runtime dependency. CI runs on GitHub-hosted runners; it is not a CryoShield-operated backend and plays no part in the product at runtime.

**Out of scope:** deployment and release automation, recovery-tool binary signing, Playwright E2E against an anvil-deployed registry (later job), branch-protection settings on the GitHub repo (manual, documented only).

## Capabilities

### New Capabilities
- `ci-pipeline`: automated verification gates that every push and pull request must pass, and the security posture of those gates.

### Modified Capabilities

## Impact

- New files under `.github/workflows/` and a short CI section in the root README.
- Closes add-vault-registry-contract task 7.1 once the contracts job is green.
- Jobs for `recover` and `web` become meaningful as those changes land; until their directories exist, the path filters simply skip them.

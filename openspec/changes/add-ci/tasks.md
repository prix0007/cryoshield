# Tasks

## 1. Workflow skeleton and hardening

- [x] 1.1 Write a failing check first: add a pinned-action/permissions lint step (actionlint + a SHA-pin check such as zizmor) and confirm it fails on a deliberately tag-pinned action, then passes once pinned — verify locally with `actionlint` and the check script
- [x] 1.2 Create `.github/workflows/ci.yml` with `push`(main)/`pull_request` triggers, top-level `permissions: contents: read`, concurrency group, `changes` path-filter job (SHA-pinned), and aggregate `ci-ok` job that treats skipped jobs as success — verify with `actionlint` and a branch run showing `ci-ok` green
- [x] 1.3 Confirm no `secrets.*` references and no `pull_request_target` anywhere — verify with `grep -rn "secrets\.\|pull_request_target" .github/` returning nothing

## 2. Contracts job

- [x] 2.1 Add `contracts` job: foundry-toolchain pinned to v1.1.0, `forge build`, `forge test` — verify the job is green on a branch and goes red on a deliberately failing test commit (then revert)
- [ ] 2.2 Add `forge snapshot --mc GasTest --check` — verify red when a snapshot entry is edited, green when restored; then tick add-vault-registry-contract task 7.1
- [x] 2.3 Add Slither 0.11.6 via `uvx` with committed suppression for the triaged false positive (linked to design.md triage) — verify the job passes and fails on an injected unsuppressed finding

## 3. vault-crypto job

- [x] 3.1 Add `vault-crypto` job: Node 22, pnpm 9.15.5, `pnpm install --frozen-lockfile`, `pnpm --filter @cryoshield/vault-crypto test` — verify green, and red when `pnpm-lock.yaml` is out of date

## 4. recover job

- [x] 4.1 Add `recover` job with Python matrix 3.10/3.12, pinned uv, `uv sync --locked`, `uv run pytest` including the cross-implementation vector tests; path filter includes `packages/vault-crypto/test-vectors/**` — verify green on both versions once `tools/recover` exists, and red when a vector file is altered

## 5. web job

- [x] 5.1 Add `web` job: lint, typecheck, unit tests for `apps/web` with frozen lockfile — verify green once `apps/web` exists

## 6. openspec job and docs

- [x] 6.1 Add `openspec` job running `openspec validate --all --strict` with a pinned OpenSpec CLI version (1.14.0) — verify red on a deliberately invalid spec, green when fixed
- [x] 6.2 Add Dependabot config for `github-actions` and document CI + the manual branch-protection step (require `ci-ok`) in the root README — verify the file parses and the README section exists

## 7. Security review

- [x] 7.1 security-reviewer reviews workflows for pinning, permissions, secret exposure, PR-trigger safety, and lockfile enforcement — APPROVE recorded

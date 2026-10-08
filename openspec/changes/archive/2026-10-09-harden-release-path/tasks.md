# Tasks

## 1. Tag ruleset (M3)

- [x] 1.1 Change `test/ruleset-files.test.mjs` first to require `include: ["~ALL"]` (every tag admin-only); see it fail. Then set `.github/rulesets/release-tags.json` to `~ALL` and update the `apply.sh` comment. Verify with `npm test --prefix .github/scripts` (the `apply.sh` tests read the committed file).
- [x] 1.2 Update the docs that say only `v*` tags are protected (`docs/deploy.md`, `docs/agent-account.md`, README) and document the owner's apply command and the probe (`refs/tags/probe-1` rejected for a non-admin). Verify by grep: no doc says only `v*` tags are admin-only.

## 2. Smoke test (L5, L4 live check)

- [x] 2.1 Add failing cases to `test/deploy-scripts.test.mjs` first: per-path headers in the stub site; `/` with `publickey-credentials-get=(self)` or without the create rule fails; `/app/` with `()` fails; `EXPECT_TREE_HASH` set and different from the live `treeHash` fails; malformed `EXPECT_TREE_HASH` is exit 2. Then implement in `smoke.sh`. Verify with `npm test --prefix .github/scripts`.

## 3. Cross-job context verification (L4)

- [x] 3.1 Write `test/verify-context.test.mjs` first: a consistent context passes in both roles and writes both outputs; tampered site file, Caddyfile, manifest commit, `release.json` commit fail; `ROLE=release` with an expectation that differs fails; empty or malformed expectation is exit 2; `ROLE=build` with expectations is exit 2; unknown role is exit 2. Then implement `.github/scripts/deploy/verify-context.sh`.
- [x] 3.2 Add failing policy tests in `test/deploy-workflow.test.mjs` first: for both workflows, removing the build outputs, the `context-hash` step, the release `verify-context` step or its `needs.build.outputs` env, or the smoke step's `EXPECT_TREE_HASH`, fails the policy. Then extend `workflow-policy.mjs`, edit `deploy.yml` and `deploy-dev.yml`, and re-pin the release-job digests (`node .github/scripts/workflow-policy.mjs --digests .github`). Verify with `npm test --prefix .github/scripts` and `node .github/scripts/workflow-policy.mjs`.

## 4. Integration

- [x] 4.1 Run `npm test --prefix .github/scripts`, `pnpm -C apps/web test:deploy`, `openspec validate --all --strict`, and actionlint/shellcheck where available. Record the numbers in the PR.

## 5. Security review

- [x] 5.1 Security review of this change (touches CI and the release path): token isolation, template injection, fail-closed behaviour of `verify-context.sh`, the `~ALL` ruleset, the re-pinned digests. Verify by recording the result in `design.md` → Security review (self-review recorded; independent review on the PR).

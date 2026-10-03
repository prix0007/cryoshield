# Tasks

## 1. Public release identity (tests first)

- [ ] 1.1 Extend `apps/web/deploy/test/release-manifest.test.ts`: `--site-release` writes `site/release.json` (name, commit, treeHash, config; no `files`, no key values), and `treeHash` is unchanged by it. Then implement it in `release-manifest.mjs`. Verify with `pnpm --filter @cryoshield/web test:deploy` (generator and manifest tests).
- [ ] 1.2 Extend the gen-context and container tests: `/release.json` is served `no-store`, as JSON, with every security header. Then add the Caddy rule in `gen-context.mjs`, and pass `--site-release` in `deploy.sh` (the deploy-sh test asserts it). Verify that the tests pass; the container test runs where Docker is available.

## 2. Deploy scripts (tests first)

- [ ] 2.1 `detect.sh` with tests against a local HTTP server:
  - same commit: skip;
  - different commit, 404, invalid JSON or unreachable: deploy;
  - `force`: deploy;
  - invalid target SHA: exit 2.
- [ ] 2.2 `previous-image.sh` with a stub `fly`: it picks the newest complete release's `ImageRef`, and rejects invalid refs, empty lists and fly errors.
- [ ] 2.3 `smoke.sh` with tests against a local server:
  - all good: pass;
  - each failure class fails and is named (status, missing header, address missing, commit mismatch);
  - retries until healthy.
- [ ] 2.4 `rollback.sh` with a stub `fly` and a local server:
  - deploys exactly the given validated image, then checks `/healthz`;
  - refuses invalid refs;
  - fails loudly with no image.

## 3. Pipeline

- [ ] 3.1 Make `ci.yml` callable (`workflow_call`, `full`), and put the caller's workflow name in the concurrency group. Verify that actionlint is clean and a policy test asserts that `full` forces every area job.
- [ ] 3.2 Add `.github/workflows/deploy.yml` (decisions 1, 5, 6). Verify that actionlint is clean and zizmor pedantic has 0 findings.
- [ ] 3.3 Tests first: the deploy rules in `workflow-policy.mjs` (decision 7):
  - a PR trigger added;
  - the token in another step or job;
  - a missing environment;
  - `secrets: inherit`;
  - another workflow using `FLY_API_TOKEN` or `production`;
  - cancellable concurrency.

  Then implement them. Verify that `npm test --prefix .github/scripts` is green and the policy is OK on `.github`.

## 4. Docs

- [ ] 4.1 Write `docs/deploy.md` (first-time setup, manual deploy, rollback, token rotation, polling cost) and update the CLAUDE.md "Change flow", the README and the `docs/system-design.md` pipeline section. Verify that the founder commands list key names only, never values.

## 5. Integration

- [ ] 5.1 Run the full local suite and verify that all are green:
  - script tests;
  - web deploy tests;
  - actionlint;
  - zizmor pedantic;
  - the workflow policy;
  - shellcheck;
  - `openspec validate --all --strict`;
  - the licence check;
  - gitleaks on the branch range.

## 6. Security review

- [ ] 6.1 The security reviewer reviews this change, covering:
  - the trigger and branch restrictions;
  - environment and secret scoping;
  - token exposure (logs, step env, artifacts);
  - `.env` generation and masking;
  - flyctl pinning;
  - detect, smoke and rollback correctness and failure modes;
  - the reusable-CI concurrency and permissions;
  - the policy robustness.

  Verify by recording an APPROVE, or the findings plus fixes, in design.md.

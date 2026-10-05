# Tasks

## 1. Policy and workflows (tests first)

- [x] 1.1 First, rewrite `test/deploy-workflow.test.mjs` (shared rules, both files) and `test/deploy-config.test.mjs`, and replace `test/gate-deploy.test.mjs` with `test/deploy-targets.test.mjs` (per-target rules). Cover:
  - triggers per file, including `release: [published]` only;
  - the owner and ref gates;
  - environments per file, cross-target refusal, and token steps per release environment;
  - concurrency groups;
  - no write scopes;
  - `tag-check` before `deploy` in production and `head-check` in dev;
  - the full CI with `ref`;
  - zizmor `self-repository` once per file.

  Then:
  - add `DEPLOY_PROFILES` to `workflow-policy.mjs`;
  - split `deploy.yml` into `deploy.yml` (production) and `deploy-dev.yml` (development);
  - remove `supersede` (job, script, test and stub).

  Proved by `npm test --prefix .github/scripts` and `node .github/scripts/workflow-policy.mjs`.
- [x] 1.2 `ci.yml`: optional `workflow_call` input `ref`, used by every area-job checkout. Proved by the `ci.yml` assertions in `test/deploy-workflow.test.mjs`.
- [x] 1.3 Review every run step of both token jobs, then re-pin their digests in `privileged-run-steps.json`. Proved by the policy run, and by the digest tests in `test/deploy-workflow.test.mjs`.

## 2. Deploy scripts (tests first)

- [x] 2.1 First, write `test/release-ref.test.mjs` (stub `fixtures/gh-git-stub.sh`). Cover:
  - the tag regex;
  - lightweight, annotated and looping annotated tags;
  - `EXPECT_SHA` mismatch;
  - `identical`/`ahead` accepted, `behind`/`diverged` refused;
  - a mismatched ref answer or non-commit object;
  - API errors fail;
  - no writes.

  Then implement `.github/scripts/deploy/release-ref.sh`.
- [x] 2.2 First, write the tests in `test/deploy-scripts.test.mjs` and `test/deploy-config.test.mjs`:
  - smoke tests for `EXPECT_NOINDEX=true` (exactly `noindex, nofollow` on every page; `robots.txt` is not used) and `false` (any noindex header refused);
  - rollback and previous-image tests for the dev `APP` and `CONFIG` (images never cross apps), and for `DEPLOY_ENVIRONMENT` naming;
  - check-config tests for `BUILD_ENVIRONMENT`/`WORKFLOW`.

  Then implement them.

## 3. Web deploy code (tests first)

- [x] 3.1 First, write `apps/web/deploy/test/deploy-sh.test.ts`:
  - `DEPLOY_TARGET=development` maps to `cryoshield-web-dev.fly.dev`, `cryoshield-web-dev`, `fly.dev.toml` and `--noindex`;
  - the production RP ID, or any RP ID under it, on dev is refused;
  - production refuses the dev RP ID;
  - `DEPLOY_HOST` is refused, and so is an unknown target.

  Then update `deploy.sh`.
- [x] 3.2 First, write `gen-context.test.ts`. With `--noindex`:
  - `X-Robots-Tag` is added on every response (errors included), and nothing else (no `robots.txt`, same site files);
  - it is refused for `cryoshield.app`;
  - without the flag, there is no header.

  Then `noindex-container.test.ts`: serve the dev Caddyfile in the pinned Caddy image, and check the header on pages, redirects and errors, and that the CSP is unchanged. Then update `gen-context.mjs`.
- [x] 3.3 First, write `fly-toml.test.ts`: `fly.dev.toml` has app `cryoshield-web-dev`, `sin`, `suspend`, min 0, the same build and check as production, and nothing secret. Then add `apps/web/fly.dev.toml`.

## 4. Rulesets (tests first)

- [x] 4.1 First, write `test/ruleset-files.test.mjs`:
  - `release-tags.json` targets tag `refs/tags/v*`, with `creation`/`update`/`deletion` and the admin role as the only bypass actor;
  - `environments.json` has `development` and `development-build` (main only, no reviewers);
  - `production`/`production-build` allow `main` plus `v*` tags.
- [x] 4.2 First, write `test/apply-sh.test.mjs` and `test/apply-sh-environments.test.mjs`, with the gh stub extended to several rulesets:
  - a dry run reports a missing tag ruleset (exit 3) and writes nothing;
  - `--apply` POSTs it, and PUTs it by id when it drifted;
  - a branch ruleset with the same name does not count;
  - an in-sync state writes nothing;
  - the environments reconcile `tag:v*` policies and create the dev environments.

  Then update `apply.sh`.
- [x] 4.3 PR #32 review findings, test first, in `test/apply-sh-environments.test.mjs`:
  - every drift case differs in exactly one property;
  - a live reviewer is removed when `environments.json` has none;
  - the owner is looked up only when an environment names `@owner` (tested with a copied `apply.sh` and a modified `environments.json`).

  Then update `apply.sh`.

## 5. Docs

- [x] 5.1 `docs/deploy.md`: the two targets, cutting a release, rollback, first-time setup for the dev environments and the app-scoped dev token, DNS, and the tag ruleset. No secret values. Remove the approval and `supersede` wording.
- [x] 5.2 Update `CLAUDE.md` step 9, the `README.md` deploy section, `apps/web/deploy/README.md`, `docs/agent-account.md` and `docs/system-design.md`, and remove the leftover approval and "waiting" wording from them.
- [x] 5.3 `docs/reviews/security-audit-2026-10.md`:
  - CI-C1 is partly restored (owner-only releases) and links to `design.md` → Security review;
  - fix CI-M2 and the fix-order line, which assumed an approval gate;
  - record T1.

## 6. Verify and security review

- [x] 6.1 All green:
  - `npm ci --ignore-scripts --prefix .github/scripts && npm test --prefix .github/scripts`;
  - `pnpm --filter @cryoshield/web test:deploy`;
  - `actionlint`;
  - zizmor pedantic;
  - `openspec validate split-dev-and-release-deploys --strict`.
- [ ] 6.2 [owner, after merge] One-time setup from `docs/deploy.md`:
  - the app-scoped dev Fly token;
  - `apply.sh --with-ecc-review --environments --apply`;
  - the `development-build` config.

  Then confirm that a merge deploys dev (with the noindex header), and that `gh release create` deploys production.
- [x] 6.3 Security review recorded in `design.md` → Security review. It covers:
  - a threat table: auto-shipped dev code; the Fly-token-path scripts running with a token and no human step; the production token gated only by owner-only `v*` tags; cross-target token use; and the subdomain RP ID (T1, now resolved: dev is on `cryoshield-web-dev.fly.dev`);
  - the compensating controls;
  - the explicit acceptance for dev;
  - the mainnet re-gate criterion.

## 7. ECC review of PR #33 (tests first)

- [x] 7.1 T1: move the dev host and RP ID to `cryoshield-web-dev.fly.dev` (another registrable domain) in `deploy.sh`, `deploy-dev.yml`, `gen-context.mjs`, `fly.dev.toml`, the tests, the docs and this change.
  - `deploy-sh.test.ts`: dev RP IDs `cryoshield.app`, `dev.cryoshield.app` and `a.b.cryoshield.app` are refused; the dev host is not under `cryoshield.app`.
  - `gen-context.test.ts`: dev hosts under `cryoshield.app` are refused.
  - `noindex-container.test.ts`: Host `dev.cryoshield.app` is redirected to the dev host.
- [x] 7.2 M1: delete `openspec/changes/remove-production-approval-gate/`. This delta REMOVES "Owner approval for production releases" (from `gate-production-deploys`).
- [x] 7.3 M2: `deploy-dev.yml` never passes `VITE_CF_BEACON_TOKEN`, and the policy forbids the name there. Test in `deploy-targets.test.mjs`.
- [x] 7.4 M3: the policy rejects job-level `always()`/`failure()`/`cancelled()` (also combined, e.g. `always() && needs.detect.outputs.deploy == 'true'`), and requires `needs.config.outputs.configured == 'true'` on jobs that need `config`. Tests in `deploy-workflow.test.mjs`.
- [x] 7.5 M4: a MODIFIED delta for `ci-pipeline` "Unconfigured deploys skip without failing": both workflows and `development-build`, with no approval scenario.
- [x] 7.6 M5: `gen-context.mjs` uses `util.parseArgs({ strict: true })` and an allowlist of the two host/noindex pairs. Tests in `gen-context.test.ts`.
- [x] 7.7 L1: the dev `head-check` runs immediately before `deploy`; a superseded run exits 0 with a notice, and `deploy`/summary/`smoke` are skipped. The production `tag-check` also runs immediately before `deploy`. The policy enforces both.
- [x] 7.8 L2: `check-config.sh` with `MISSING_IS_ERROR=true` (production) fails. L3: the org-owner caveat is in `design.md` and `docs/deploy.md`. L4: `fly-toml.test.ts` parses the TOML per table. L5: `deploy-sh.test.ts` drops inherited `DEPLOY_*` and asserts the gen-context call. L6: `write-env.sh` names `BUILD_ENVIRONMENT` in its messages.
- [x] 7.9 Re-run every suite, `actionlint`, `zizmor`, `shellcheck` and `openspec validate --all --strict`; re-pin the changed dev `head-check` digest.
- [ ] 7.10 [owner] Delete the DNS records for `dev.cryoshield.app` (its Fly certificate is already removed).

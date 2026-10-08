# Proposal: harden the release path (pre-production review M3, L4, L5)

## Why

The pre-production security review of 2026-10-09 (`docs/reviews/2026-10-09-pre-production.md`, hosting report) found no CRITICAL or HIGH issue in the release path, but three code follow-ups:

- **M3 (medium).** The production boundary rests on two `v*` patterns that were never tested for equivalence: the `release-tags` ruleset (`include: refs/tags/v*`, admins only) and the `production`/`production-build` environment tag policy (`v*`). A run at a tag uses the workflow file from that tag, so whoever can create a tag the environment accepts can remove the owner check from `deploy.yml` and reach `FLY_API_TOKEN`. If the environment pattern ever matched a tag name the ruleset does not cover, a Write-role account (the agents' machine account, once added) could do that.
- **L4 (low).** The release job verifies the downloaded deploy context only against `release-manifest.json`, which travels inside the same artifact. A consistent forged artifact passes that check.
- **L5 (low).** The smoke test does not assert the Permissions-Policy split: a Caddyfile regression that gives the landing page WebAuthn, or takes it away from `/app/`, would deploy green.

## What Changes

- **M3:** `.github/rulesets/release-tags.json` includes `~ALL`, so creating, moving or deleting **any** tag is admin-only. The environment policy can then only ever match a tag that only an admin can create, whatever the glob semantics. The ruleset tests pin the new include, and the docs (`docs/deploy.md`, `docs/agent-account.md`, README, CLAUDE.md wording) say "every tag". The owner applies it with `.github/rulesets/apply.sh --with-ecc-review --environments --apply` and verifies it with a rejected non-admin tag push (`refs/tags/probe-1`).
- **L5:** `.github/scripts/deploy/smoke.sh` asserts `publickey-credentials-get=()` and `publickey-credentials-create=()` on `/` (the landing document), and `publickey-credentials-get=(self)` and `publickey-credentials-create=(self)` on `/app/`.
- **L4:**
  - a new script, `.github/scripts/deploy/verify-context.sh`, computes the site tree hash and the Caddyfile hash of a deploy context and checks them against its manifest (the check that was inline in both release jobs);
  - the build job runs it after the build and exposes `tree_hash` and `caddyfile_hash` as **job outputs**, which reach the release job through GitHub, not through the artifact;
  - the release job runs it with `EXPECT_TREE_HASH` and `EXPECT_CADDYFILE_HASH` from `needs.build.outputs`, and refuses a context that differs;
  - the smoke test also requires the live `/release.json` `treeHash` to equal the build job's tree hash (`EXPECT_TREE_HASH`);
  - the same for `deploy.yml` and `deploy-dev.yml`, enforced by `workflow-policy.mjs`.

**Runtime dependencies:** none. This is CI, repository configuration and docs. No CryoShield-operated backend is added.

**Out of scope:**
- Comparing every live file's hash after deploy (the treeHash in `/release.json` and the header checks are the post-deploy evidence; per-file comparison is a possible later change).
- The founder-only items of the review (DNSSEC, CAA, Pimlico dashboard limits, repository security settings).
- Asserting the exact CSP in the smoke test.

## Capabilities

### Modified Capabilities
- `continuous-deployment`: every tag is admin-only; the smoke test checks the Permissions-Policy split and the live tree hash; the release job verifies the context against the build job's outputs.
- `ci-pipeline`: the deploy workflow policy requires the build outputs and the release job's cross-job verification.

## Impact

- **Edited:** `.github/rulesets/release-tags.json`; `.github/scripts/deploy/smoke.sh`; `.github/workflows/deploy.yml` and `deploy-dev.yml` (owner pushes these, the agent token has no Workflows permission); `.github/scripts/workflow-policy.mjs`; `.github/scripts/privileged-run-steps.json` (reviewed digests); tests in `.github/scripts/test/`; `docs/deploy.md`, `docs/agent-account.md`, README, `.github/rulesets/apply.sh` comment.
- **New:** `.github/scripts/deploy/verify-context.sh` and its tests.
- **After merge (owner):** run `.github/rulesets/apply.sh --with-ecc-review --environments --apply`, then the tag probe.

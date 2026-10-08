# Design: harden the release path

## Context

The production release path (changes `gate-production-deploys`, `split-dev-and-release-deploys`) has three independent layers: the `release-tags` ruleset, the owner gate on the first job of `deploy.yml`, and the `production`/`production-build` environments that accept only `v*` tags. The pre-production review (2026-10-09, hosting report) verified all three live and found:

- **M3:** the owner gate lives in the workflow file, and a run at a tag uses the file from that tag. So the real boundary is the pair (ruleset pattern, environment pattern). Both are `v*` globs, but nothing proves they match the same set of names (case, `refs/tags/` prefix, glob flavour). Today the only collaborator is the admin owner, so it is not exploitable; it matters once the Write-role machine account exists.
- **L4:** `release` verifies the downloaded artifact against `release-manifest.json`, which is inside the same artifact. The workflow comment admits that a consistent forged manifest passes.
- **L5:** `smoke.sh` checks CSP `frame-ancestors`, HSTS, XFO, nosniff, referrer, COOP and CORP, but not the Permissions-Policy split from `add-privacy-preserving-analytics` (no WebAuthn on the landing document, WebAuthn for self elsewhere).

## Goals / Non-Goals

**Goals:** make the tag boundary independent of glob semantics; make the build-to-release hand-off cross a channel the artifact cannot forge; make a Permissions-Policy regression fail the deploy and roll back.

**Non-Goals:** per-file live hash comparison; exact CSP matching in the smoke test; any founder-only setting (DNS, Pimlico, repository security settings).

## Decisions

### D1. Every tag is admin-only (`~ALL`)

`release-tags.json` `conditions.ref_name.include` becomes `["~ALL"]` (GitHub's token for every ref of the ruleset's target, here every tag). Creation, update and deletion of any tag then need the admin role, the ruleset's only bypass actor. Whatever the environment's `v*` policy matches, it can only match a tag an admin created.

*Alternatives:* (a) a test that the two `v*` patterns are equivalent: it would test our reading of GitHub's matching, not GitHub. (b) Adding case variants (`V*`): still a pattern argument. `~ALL` removes the question.

*Cost:* nobody but admins can create any tag. The project uses tags only for releases, and agents never create tags (CLAUDE.md), so nothing legitimate breaks.

*Applying it:* agents never change rulesets. After merge the owner runs `.github/rulesets/apply.sh --with-ecc-review --environments --apply` (the dry run without `--apply` prints the drift first). Verification, as the machine account once it exists: `git push origin HEAD:refs/tags/probe-1` and `git push origin HEAD:refs/tags/V0.0.1-probe` must both be rejected by the ruleset. A rejected push creates nothing, so there is nothing to clean up.

### D2. `verify-context.sh`: one hash routine for build and release

The inline "Verify the context against its release manifest" step was identical in both release jobs. It moves to `.github/scripts/deploy/verify-context.sh`, unchanged in what it computes:
- tree hash: `sha256` over `sha256sum` lines of every file under `site/` except `release.json`, sorted with `LC_ALL=C` (the same algorithm as `apps/web/deploy/release-manifest.mjs`);
- Caddyfile hash: `sha256` of `Caddyfile`;
- manifest `commit`, `site/release.json` `commit` == `SHA`; manifest `treeHash` and `caddyfile` == the computed hashes.

Inputs (env): `SHA` (40-hex, required), `CONTEXT_DIR` (default `apps/web/deploy/.build`), `ROLE` (`build` or `release`, required). With `ROLE=release`, `EXPECT_TREE_HASH` and `EXPECT_CADDYFILE_HASH` are **required**, must be `sha256:<64 hex>`, and must equal the computed hashes; an empty or malformed value is a usage error (exit 2), never a skipped check. With `ROLE=build` they must be absent. Both roles write `tree_hash=` and `caddyfile_hash=` to `$GITHUB_OUTPUT` when it is set. It uses only bash, coreutils, find, sed and jq, so the token-holding release job still runs no build tooling.

### D3. The hashes cross jobs as job outputs

The build job runs `verify-context.sh` (`ROLE=build`, step id `context-hash`) right after the guarded build and the manifest check, and declares:

```yaml
outputs:
  tree_hash: ${{ steps.context-hash.outputs.tree_hash }}
  caddyfile_hash: ${{ steps.context-hash.outputs.caddyfile_hash }}
```

The release job's verify step (id `verify-context`) passes `EXPECT_TREE_HASH: ${{ needs.build.outputs.tree_hash }}` and `EXPECT_CADDYFILE_HASH: ${{ needs.build.outputs.caddyfile_hash }}` through its step env (no `${{ }}` in `run:`). Job outputs are stored by GitHub with the run, separately from the artifact, so an artifact replaced or altered after the build no longer passes. The smoke step passes `EXPECT_TREE_HASH` too, and `smoke.sh` requires the live `/release.json` `treeHash` to equal it, which ties the live site to the build job's hash rather than to the artifact.

What this does **not** cover: a compromised build job can still forge both its outputs and the artifact consistently. The build job runs all third-party build code; that residual risk is unchanged and stays recorded (`gate-production-deploys` design, ECC #5).

### D4. Policy

`workflow-policy.mjs`, per deploy profile:
- the `build` job declares exactly those two outputs from step `context-hash`, whose `run` calls `.github/scripts/deploy/verify-context.sh` with `ROLE: build`;
- the release job has a step `verify-context` calling the script with `ROLE: release` and the two `needs.build.outputs` expressions, before the re-check and the `deploy` step;
- the smoke step's env has `EXPECT_TREE_HASH: ${{ needs.build.outputs.tree_hash }}`.

The release-job run-step digests in `privileged-run-steps.json` are re-pinned after review.

### D5. Smoke: Permissions-Policy split

`smoke.sh` already fetches `/` and `/app/`. It adds:
- `/`: `permissions-policy` contains `publickey-credentials-get=()` and `publickey-credentials-create=()`;
- `/app/`: it contains `publickey-credentials-get=(self)` and `publickey-credentials-create=(self)`.

The other public pages (`/architecture`, `/devices`, `/support`, `/privacy`) are not the landing document and by design (`gen-context.mjs`, only `/` and `/index.html` lose WebAuthn) carry the app policy; asserting `()` there would fail a correct deploy, so they are not checked for it. Header names are compared lower-case (as all smoke header checks); a substring match on `get=()` cannot match `get=(self)`.

`EXPECT_TREE_HASH` is optional in `smoke.sh` (a manual run against a site needs no build), but when set it must be `sha256:<64 hex>` and equal the live treeHash. The workflows always set it (D4).

## Threat / abuse

| Threat | Before | After |
|---|---|---|
| Write-role account pushes a tag the production environment accepts but the ruleset does not cover, with the owner gate deleted from its `deploy.yml` | relies on two `v*` globs matching identically | no tag can be created without admin (D1) |
| Artifact replaced or altered between build and release (e.g. a bug or misuse of artifact names) | passes if its manifest is consistent | fails: hashes must equal the build job's outputs (D3) |
| Caddyfile regression gives the landing page WebAuthn or removes it from `/app/` | deploys green | smoke fails, automatic rollback (D5) |
| Live site serves a different tree than the build produced | only the commit is checked | the live treeHash must equal the build job's (D3) |
| Compromised build job forges outputs and artifact together | not covered | still not covered (residual, documented) |
| Empty build output silently disables the check | n/a | `ROLE=release` requires both values; empty is exit 2 |

## Risks / Trade-offs

- `~ALL` makes every tag admin-only: tools that tag (none today) would need the owner. Accepted.
- Moving the inline step into a script changes the reviewed digests of both release jobs; the security review covers the new step text and the script.

## Security review

Reviewer: implementing agent (self-review against the checklist below), 2026-10-09. An independent review by the `security-reviewer` agent or the ECC reviewer on the PR is still required before merge; the result is to be appended here.

Checked:
- **Token isolation:** `FLY_API_TOKEN` still appears only in the `deploy` and `rollback` step envs of the release job; `verify-context.sh` gets no secret. `workflow-policy.mjs` passes on both workflows.
- **No template injection:** the new `${{ }}` expressions are only in `env:` and `outputs:`; no `run:` contains `${{`. The job outputs are hex hashes validated by the script's regex before use.
- **Fail-closed:** `ROLE=release` with an empty, missing or malformed expectation exits 2; a mismatch exits 1, before `tag-check`/`head-check` and `deploy`, so nothing is deployed and no rollback is needed.
- **Release job tooling:** the script uses bash, coreutils, find, sed, jq only; the policy's no-build-tooling rule still holds.
- **Actions:** no new action; all remain SHA-pinned; permissions unchanged (`contents: read`).
- **Ruleset:** `~ALL` with bypass role 5 only; `apply.sh` reconciles it by name and target as before; the change only widens the protected set.
- **Smoke:** the new assertions only add failure conditions; they cannot make a bad deploy pass.

Result: no blocking findings in self-review. Residual: D3's compromised-build case, as before.

Verification (2026-10-09, local): `npm test --prefix .github/scripts` 402/402 (was 390; +12 new); `node .github/scripts/workflow-policy.mjs .github` OK; actionlint clean on both deploy workflows; zizmor 1.30.1 pedantic offline: no findings; shellcheck clean on `smoke.sh` and `verify-context.sh`; `openspec validate --all --strict` 37/37. `pnpm -C apps/web test:deploy` 120/122: the two failures are `verify-real-env.test.ts`, which needs a real `apps/web/.env` that the worktree does not have (environment only; this change does not touch `apps/web`). Release-job digests re-pinned: only the verify step changed (`9d93d773…`, same text in both workflows); the smoke step's run text is unchanged (only its env gained `EXPECT_TREE_HASH`).

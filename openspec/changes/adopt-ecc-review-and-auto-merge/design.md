# Design

## Context

From `adopt-pr-workflow`, `main` is protected by the `main` ruleset:
- the `ci-ok` check is required, in strict mode;
- squash-only merges;
- no bypass actors;
- the Actions token is read-only by default;
- `workflow-policy.mjs` forbids every privileged trigger.

The founder wants outlai's review and merge flow. The read-only reference files were:
- outlai `ecc-review.yml`;
- outlai `auto-merge.yml`;
- the PR template;
- `AGENTS.md`;
- `CLAUDE.md` → "Change flow".

Both outlai workflows rely on `pull_request_target`. That conflicts with our policy, so the policy has to gain a narrow, tested exception.

## Goals / Non-Goals

**Goals:**
- Port outlai's flow with every safeguard kept.
- Keep the privileged surface mechanically checked, so a later edit cannot quietly drop a guard.

**Non-Goals:**
- Making `ecc-review` required now.
- Reviewing fork PRs.
- Merge queues and automatic branch updates.

## Decisions

### 1. `pull_request_target` for both workflows

This trigger makes the workflow file come from `main`, so a PR cannot edit the gate that judges it. It also has secrets for fork PRs, so:
- `ecc-review`'s FIRST step fails fork PRs. The job is not skipped, because a skipped required check counts as passing.
- `auto-merge`'s job `if` limits it to same-repo PRs. Skipping is fine there, because it gates nothing.

zizmor's `dangerous-triggers` is ignored only at `ecc-review.yml:29` and `auto-merge.yml:12`, the `on:` lines, in `.github/zizmor.yml`. The policy script rejects any other ignore.

`issue_comment` is treated the same way. It is used only by the owner-only `rerun` job, which has no Claude credential and no checkout.

### 2. Safeguards kept from outlai, and the CryoShield changes

The kept safeguards:
- fork refusal first;
- a fail-closed credential check;
- a read-only head checkout at the exact head SHA;
- no git credentials in `.git/config`;
- the ECC plugin pinned, verified (HEAD equals the pin, clean tree), moved to `$RUNNER_TEMP`, and its `.mcp.json` deleted;
- the PR collected to files by a `gh` step, so the agent gets no GitHub access;
- bubblewrap installed and proven;
- `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`;
- the agent limited to `Agent,Read,Grep,Glob,Edit(<review dir>/**)`, with Bash disallowed and `/proc` and `.git` unreadable;
- a separate step that posts one review after a credential-shaped-output guard, plus a verdict whitelist;
- a gate step that requires a non-blocking bot review for the head SHA and dismisses superseded bot blocks;
- an owner-only `/ecc-review` re-run of the PR's own run.

The CryoShield changes, by area.

**Checkout and credentials:**
- The head checkout uses `persist-credentials: false`. CryoShield has no gitlinks (verified: 0 entries with mode 160000), so outlai's submodule workaround is not needed. The "assert no extraheader" step stays as a check.
- `actions/checkout` v7.0.1 is the same pin as `ci.yml`.

**Agent configuration and tools:**
- We restore the agent configuration from the base commit ourselves, as defence in depth: `.claude`, `.claude.json`, `.mcp.json`, `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `.gitmodules`, `.ripgreprc` and `.husky`. claude-code-action v1.0.240 also does this (`restoreConfigFromBase`, read in the source at the pinned commit).
- `WebFetch` and `WebSearch` are also disallowed, so the agent has no network tools.

**Workflow settings:**
- Top-level `permissions: {}`, and every job lists its scopes with comments.
- The `rerun` job has a concurrency group.

**Prompt:**
- It contains the CryoShield reviewer matrix, `openspec/config.yaml`, and spec lookup that includes archived changes.
- It tells the reviewer never to quote key material.

### 3. Policy exception (`workflow-policy.mjs`, `PRIVILEGED`)

`pull_request_target` and `issue_comment` are allowed only in files named `ecc-review.yml` and `auto-merge.yml`, and only under these rules:
- **Triggers:** only those listed for the file. `workflow_run` stays forbidden everywhere.
- **Permissions:** top-level `permissions: {}`. Write scopes come from a per-job allow-list:
  - `ecc-review`: `review` may have `pull-requests`, and `rerun` may have `actions`;
  - `auto-merge`: `auto-merge` may have `contents` and `pull-requests`.
- **Fork refusal for PR-triggered jobs:** either the job `if` contains the same-repo condition, or the FIRST step is a run step with `if: <fork condition>` that exits 1.
- **Comment-triggered jobs:** the `if` must contain `author_association == 'OWNER'`, and the job may use no actions at all.
- **Actions:** only `actions/checkout` and `anthropics/claude-code-action`, both SHA-pinned. No local actions.
- **Checkout:** forbidden in `auto-merge.yml`. In `ecc-review.yml`, the repository checkout must use `ref: <head SHA>`, and every checkout must set `persist-credentials: false`.
- **Run steps:** none may match the "executes the checkout" denylist. It covers `./x`, `sh`/`bash` with a file, `source` or `.`, node, python, pip, npm, pnpm, npx, yarn, make, uv/uvx, bun, deno, `go run`/`build`/`test`, cargo, forge, anvil, docker, eval, exec and `chmod +x`. Full-line comments are ignored.
- **Secrets:** none in the workflow-level env. A job-level env may hold only `secrets.GITHUB_TOKEN`, and only in jobs without a checkout. Third-party secrets go per step.

The tests (`test/privileged-workflows.test.mjs`) mutate the real files: one guard is removed or moved per case, and each must fail.

### 4. Pins (verified 2026-10-04, not copied from outlai)

- **`anthropics/claude-code-action` v1.0.240 = `ed670b4cf9de2a5a570d130d2f6197b9e543cd64`.** It is the annotated tag's target and is identical to `main`. outlai pins v1.0.239. The inputs used exist in `action.yml` at that commit.
- **ECC v2.2.3 = `c05b2d6614f62f6db0047669aa4eefb223d478f9`.**
  - It is the annotated tag's target, and an ancestor of `main`.
  - It is the latest stable release; outlai pins `ef648e0`, a newer untagged `main` commit.
  - It provides the marketplace `ecc` with plugin `ecc`, and the agents `code-reviewer`, `security-reviewer`, `typescript-reviewer`, `react-reviewer` and `python-reviewer`.
- **`actions/checkout` v7.0.1 = `3d3c42e5aac5ba805825da76410c181273ba90b1`.**
- **Model:** `REVIEW_MODEL: claude-opus-5-5` (outlai uses Sonnet), set as one workflow env var.

### 5. Auto-merge

The workflow is outlai's, plus:
- `permissions: {}` at the top;
- a per-PR concurrency group, so the latest label state wins;
- `ubuntu-24.04`.

Other changes:
- `repo-settings.json` gains `allow_auto_merge: true`.
- `apply.sh` creates the `hold` label next to `no-spec`. The labels are kept in bash 3.2-compatible form, because macOS `/bin/bash` is 3.2.

### 6. Opt-in required check

`.github/rulesets/ecc-review-check.json` (`ecc-review`, bound to integration 15368) is merged into the ruleset only with `apply.sh --with-ecc-review`. Without the flag, `--apply` refuses to run against a live ruleset that already requires `ecc-review`. This prevents a later plain run from silently dropping the gate.

### 7. Docs

- `CLAUDE.md` holds the project rules (from `openspec/config.yaml`) and the adapted change flow. Its last step archives the OpenSpec change instead of outlai's dev deploy and `progress.md`.
- `AGENTS.md` points to it.
- The PR template merges outlai's sections and keeps ours. "Tests run" becomes "Verification".

## Threats / abuse

| Threat | Mitigation |
|---|---|
| A PR edits the review workflow or its prompt | `pull_request_target` runs `main`'s workflow file. |
| Fork PR exfiltrates secrets | The first step refuses forks. `auto-merge` only runs same-repo PRs. |
| PR code executed with secrets | The head is checked out read-only. The run-step denylist and allow-listed actions are enforced by the policy. The agent has no Bash. `.claude`, `CLAUDE.md` and `.mcp.json` come from base; the action restores them and so do we. |
| Prompt injection in PR text or code | The agent cannot post, approve or call the API. Its only output is two files, posted after a credential guard and verdict whitelist. Injected instructions are reported as findings. The worst case is a distorted review of that PR, with auto-merge still bound to `ci-ok`. |
| Credential leak in the review body | Pattern plus exact-secret `grep` guard before posting. The agent's subprocess environment is scrubbed under bubblewrap. |
| A compromised plugin or action update | Commit pins verified against tags and default branches, and the plugin is verified at runtime. `.mcp.json` is removed, and bumps are deliberate. |
| Anyone triggers `/ecc-review` | Owner-only. It re-runs only the PR's own run, and refuses fork heads. |
| Auto-merge merges something unreviewed | It merges only when required checks pass. `ecc-review` must be made required once the secret exists. Until then, auto-merge is bound to `ci-ok`, the same bar as today's manual merge. `hold` is the veto. |
| The bot dismisses a human review | The gate step dismisses only `github-actions[bot]` reviews. |

## Risks / Trade-offs

- **Until `--with-ecc-review` is applied,** a PR can auto-merge on `ci-ok` alone, even if the ECC review requested changes. The founder should add the secret and enable it promptly. If that matters before then, the `hold` label is the stop.
- **Workflow merges don't start `push` CI on `main`.** Strict "up to date" ensures every PR was tested on top of the current `main`.
- **Strict mode with auto-merge:** a PR waits for a manual "Update branch" when `main` moves.
- **The auditor persona flags `secrets-outside-env`.** Optional hardening: move the Claude secret into a GitHub Environment restricted to `main`. It isn't done, to keep setup to one secret.
- **The run-step denylist is heuristic.** It is backed by the action allow-list and review of `.github/**` changes, which the OpenSpec gate and the ECC security reviewer cover.
- **`ecc-review` cannot run on the PR that adds it,** because `pull_request_target` uses `main`'s copy. The first real run is the next PR after merge.

## Migration Plan

1. Merge this change.
2. The founder adds the repo secret `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`) or `ANTHROPIC_API_KEY`.
3. The admin runs `.github/rulesets/apply.sh --apply` (auto-merge setting and `hold` label).
4. After one successful ECC review, the admin runs `.github/rulesets/apply.sh --with-ecc-review --apply`.

Rollback: delete the two workflows. If needed, run `apply.sh --apply`, then remove `ecc-review` from the ruleset by hand.

## Security review (2026-10-04)

The security reviewer verdict was **APPROVE WITH FIXES**. Confirmed sound:
- all three pins are the official tags' targets;
- our base restore list is a superset of the action's `SENSITIVE_PATHS`;
- git operations on the checkout read no PR-controlled config;
- ECC's `SessionStart` hooks are benign;
- the verdict whitelist, `--body-file` posting, and dismissals limited to `github-actions[bot]`;
- the `apply.sh` refusal guard and the narrow zizmor ignores.

Every finding below was fixed test-first (`test/privileged-workflows.test.mjs`, red first).

### HIGH

1. **ECC plugin hooks could run code in the review job.**
   - Scenario: hooks such as `quality-gate.js` and `stop-format-typecheck.js` run `npx` formatters in the edited file's directory. A prompt-injected agent could write `package.json` and a config into the review directory. That code then runs, and it can read the job token the action writes to `.git/config`.
   - Fixes:
     - the moved plugin's `hooks/hooks.json` is replaced with `{"hooks":{}}` (`plugin.json` declares no other hooks; checked at the pin);
     - the step sets `ECC_HOOKS_ENABLED=false` (honoured by ECC's `hook-flags.js`; checked at the pin);
     - `--allowedTools` may write exactly `body.md` and `verdict.txt`;
     - `Grep(./.git/**)` and `Glob(./.git/**)` are denied as well (LOW-1);
     - `GATEGUARD_EXEMPT_GLOBS` is dropped.

     The policy requires the exact tool lists, both env flags, and the hooks-emptying line.
2. **Dependabot PRs would have auto-merged.**
   - Fix: the job condition adds `user.login != 'dependabot[bot]'` and a default-base-branch check. The policy requires both conjuncts.

### MEDIUM

3. **The policy did not hold its guards.** These all passed before the fix:
   - giving the agent `Bash`;
   - `continue-on-error`;
   - `if: always()`;
   - an `echo "exit 1"` refusal;
   - `|| true` in a job condition;
   - custom `shell:` or `defaults`;
   - an unpinned same-repo `repository:` checkout;
   - denylist gaps.

   Fixes:
   - exact `claude_args` flags and tool lists;
   - no `continue-on-error`, `always()`, `failure()` or `cancelled()`, and no `shell` or `defaults`;
   - the refusal run must contain a line that is exactly `exit 1`;
   - job conditions may contain no `||`, and each must include its declared conjuncts exactly;
   - a same-repo checkout must use `ref` equal to the head SHA. An external checkout must use literal env pins (`owner/name`, 40-hex).
   - **Every run step is pinned by SHA-256** in `.github/scripts/privileged-run-steps.json`. Any edit needs a deliberate digest update (`workflow-policy.mjs --digests`), and stale pins fail. This replaces relying on the heuristic denylist, which stays as a widened backstop: interpreters, `/bin/*`, `env`, `xargs`, `git -c`, `bunx`, `awk -f`.
4. **The review would only be post-merge until it is required.**
   - Fix: `auto-merge.yml` reads the base branch rules (`GET repos/{repo}/rules/branches/{base}`). It enables auto-merge only when `ecc-review` is required; otherwise it disables auto-merge with a notice. This supersedes decision 5: no PR auto-merges before `apply.sh --with-ecc-review --apply`.

### LOW

- **L1:** fixed, as part of H1.
- **L2:** a `/ecc-review` re-run replays the original workflow file. The `rerun` job now refuses runs created before the latest commit to `ecc-review.yml`.
- **L3:** the action rejects bot actors, so Dependabot PRs could never pass a required `ecc-review`.
  - Fix: set `allowed_bots: dependabot[bot]`.
  - Dependabot-triggered runs only see Dependabot secrets, so the founder adds the Claude credential as **both** an Actions secret and a Dependabot secret.

Trigger lines moved, so the zizmor ignores are now `ecc-review.yml:31` and `auto-merge.yml:19`.

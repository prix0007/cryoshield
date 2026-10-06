# Design

## Context

Three things decide what runs automatically on a pull request:

| Workflow | Trigger | Secrets | Who it runs for today |
|---|---|---|---|
| `ci.yml` | `pull_request` | none for forks | same-repo branches always; forks after GitHub's approval, by default only for first-time contributors |
| `ecc-review.yml` (`review`) | `pull_request_target` | Claude credential, write token | every same-repo, non-draft PR (Dependabot included); forks are refused by the first step |
| `auto-merge.yml` | `pull_request_target` | write token | every same-repo, non-draft, non-Dependabot PR into `main` |

`ecc-review` is (or will be, after `apply.sh --with-ecc-review --apply`) a required check, and the `main` ruleset needs zero approvals, so for same-repo PRs the review and auto-merge together are the whole gate. The founder wants that automation only for PRs the owner pushed; everything else needs the owner's approval.

Same-repo PR authors other than the owner need the Write role, which only the owner (admin) can grant. Today that is the future machine account (`docs/agent-account.md`) and Dependabot.

## Goals / Non-Goals

**Goals:**
- `ecc-review` spends the Claude credential automatically only for trusted authors.
- `auto-merge` is enabled only for trusted authors.
- For anyone else the required `ecc-review` check fails closed until the owner approves, per push.
- Fork PRs need approval before any workflow runs.
- Every guard is code: committed, tested and enforced by `workflow-policy.mjs`.

**Non-Goals:**
- ECC review of fork PRs (decision 7).
- Ruleset-enforced code-owner approval (decision 6).
- Changes to `ci.yml`.

## Decisions

### 1. Trusted authors: the owner, plus `.github/trusted-authors.json` read from the default branch

An account is trusted when it equals `github.repository_owner` (case-insensitive, as GitHub logins are), or appears in `.github/trusted-authors.json`.

Automation requires **both** to be trusted:
- the PR author, `github.event.pull_request.user.login`;
- the event's sender, `github.event.sender.login`: the pusher, or whoever labelled.

Checking only the author would let a non-trusted Write user push a commit to the owner's PR branch and get it reviewed and auto-merged (security review H2).

- The file starts as `["prix0007"]`. That repeats the owner on purpose: if the repository moves to an organization (option A in `docs/agent-account.md`), `github.repository_owner` becomes the organization and the owner's PRs keep working.
- The machine account is added when the founder creates it (`docs/agent-account.md`, step 1).
- Both workflows read the file with the contents API at `ref=<default branch>`. The PR's own copy is never read, so a PR cannot add its author. (`pull_request_target` runs the workflow from `main` anyway.)
- A missing or malformed file, or any API error, fails the gate step: closed, never open.
- `workflow-policy.mjs` validates the committed file: a JSON array of 1 to 20 unique GitHub logins (`[A-Za-z0-9-]`, no `[bot]`, no wildcards). CODEOWNERS covers it through `/.github/`.

**Why not owner-only with no file?** It is a little simpler, but the machine account would then need a workflow edit to become trusted, and a repository transfer would silently untrust the owner. A data file read from `main` keeps the workflows unchanged and keeps the trust decision reviewable in one place.

**Why not a repository variable (`vars.TRUSTED_AUTHORS`)?** It is not reviewable as code and is invisible to the policy and tests.

**What adding a name grants.** Trust only matters for **same-repo** PRs (forks are excluded by both workflows, independently of the list), and a same-repo PR needs the Write role, which only the admin can grant. Adding a login to the list therefore grants nothing unless the owner has also made that account a collaborator.

### 2. Non-trusted PRs: the owner approves a push by commenting `/ecc-review`

Two triggers were considered:

- **A label (`ok-to-review`).** Rejected:
  - `ecc-review` would need the `labeled` trigger. Every label change (`hold`, triage labels) would then start a run, and a run whose job is skipped by a job-level `if` reports a *skipped* `ecc-review` check, **which GitHub counts as passing**. Adding `hold` to a blocked PR could unblock it.
  - Any Write user (the machine account) can apply labels, so the label alone does not prove the owner approved.
  - A label survives later pushes, so it would approve commits the owner never saw unless the workflow also removed it.
- **The owner's `/ecc-review <sha>` comment** (chosen). It reuses the existing `rerun` job, which already accepts only `author_association == 'OWNER'`, re-runs the PR's latest review run, refuses forks, and holds no Claude credential. The bare `/ecc-review` stays the re-run command for trusted PRs.

A re-run replays the original event, so the gate cannot rely on who triggered it. Instead, the gate step itself counts approvals at run time. An approval is an issue comment on the PR that meets all of these:
1. its author login is `github.repository_owner` and its `author_association` is `OWNER`;
2. it is **unedited** (`updated_at == created_at`). A Write user can edit other people's comments, so an edited comment would let them forge an approval (security review H1);
3. it was created after `github.event.pull_request.updated_at` of the event that started the run;
4. its body **starts** with `/ecc-review <sha>`, where `<sha>` is 7 to 40 hex characters and a prefix of the run's head SHA (security review H3a).

The gate passes when the number of approvals is at least `max(1, GITHUB_RUN_ATTEMPT - 1)`. So every re-run attempt needs its own owner approval, and a Write user re-running an approved run from the Actions UI cannot spend the credential again (security review H3b).

`updated_at` in the event payload is the PR's last update when the push (or open, reopen or ready-for-review) happened. Consequences:
- A new push starts a new run with a newer `updated_at` and a new head SHA, which needs a new approval.
- Force-pushing an older commit back and re-running its old run fails, because the approval names a different commit.
- The owner's approval also fixes the T5 race: the comment names the commit the owner actually read.
- A non-owner comment never approves: the `rerun` job ignores it, and the gate checks the login and association again.
- The PR cannot influence the check: the workflow, the gate step and the trusted list all come from `main`.

### 3. Fail fast, not pending

For non-trusted authors the `review` job **fails** in its second step, with:

> `Awaiting owner approval: @<author> (pushed by @<sender>) is not a trusted author ... The repository owner reviews the PR and comments /ecc-review <head sha> to run it for this commit.`

Alternatives:
- **Skip** (job-level `if`): a skipped required check counts as passing. This is ruled out.
- **Pending** (leave the check queued, or post a pending commit status): this would need either a job that waits (it burns runner minutes and times out into a failure anyway), or an extra `statuses: write`/`checks: write` scope and a status context separate from the `ecc-review` check run, which the ruleset could not tell apart.

A failed check is fail-closed, needs no new permission, costs seconds, and says exactly what to do. When the owner comments, the re-run replaces the failed check run on the same commit.

### 4. Gate placement

- **`ecc-review` / `review`.** The gate is step 2, directly after the fork refusal that the policy already requires as step 1. It runs before the credential check, before every checkout and before the model.
  - Its inputs arrive only through `env:` (`AUTHOR`, `SENDER`, `OWNER`, `PR_UPDATED_AT`, `DEFAULT_BRANCH`, `GH_TOKEN`; `HEAD_SHA` and `PR` from the job env; `GITHUB_RUN_ATTEMPT` from the runner), never as `${{ }}` in `run:`.
  - An empty event time or head SHA fails the step (`${VAR:?}`).
  - It has no `if:`, and `continue-on-error` and `always()` are already forbidden in privileged workflows, so no later step runs after it fails.
  - It needs no new permission: `contents: read` reads the list, and `pull-requests: write` (already held) covers listing issue comments on a PR.
- **`auto-merge`.** The gate is step 1 (`id: author`) and writes `trusted=true|false` to `$GITHUB_OUTPUT`.
  - `synchronize` is added to the triggers, so every push re-checks the author and the sender.
  - For a non-trusted author or sender it runs `gh pr merge --disable-auto` (also undoing auto-merge that a Write user switched on by hand), prints a notice and exits 0. A red ✗ on every external PR would only be noise; `auto-merge` is not a required check.
  - If the list cannot be read, it still switches auto-merge off, then fails the step (security review L1).
  - A side effect: a non-trusted Write user who labels an owner PR also switches its auto-merge off. That fails safe; the owner re-enables it by toggling a label.
  - The existing enable step now has `if: steps.author.outputs.trusted == 'true'`.
  - The job-level conditions (same repo, not draft, default base, not Dependabot) are unchanged.

### 5. Fork PR workflow approval as code

`.github/rulesets/fork-pr-approval.json` holds `{"approval_policy": "all_external_contributors"}`. It is a sibling file, not part of `actions-permissions.json`, because it is a different endpoint (`/actions/permissions/fork-pr-contributor-approval`) with its own GET/PUT shape.

`apply.sh` syncs it in every run, like the workflow permissions:
- the dry run shows the diff and exits 3 on drift;
- `--apply` sends `PUT ... --input fork-pr-approval.json` and re-checks.

It is part of the default set (no flag), because it only narrows who can run workflows.

With it, `ci.yml` never runs a fork's code until an admin clicks "Approve and run", whatever the contributor's history. Fork `pull_request` runs still get no secrets and a read-only token.

### 6. CODEOWNERS yes; `require_code_owner_review` no

`.github/CODEOWNERS` already has `* @prix0007`, so the owner is requested on every PR. Turning on `require_code_owner_review` in `main.json` would break the owner's own flow:
- GitHub never lets an author approve their own PR, and the owner is the only code owner, so **no owner PR could ever merge**. The ruleset has no bypass, admins included, by design.
- Auto-merge would wait forever for an approval that cannot come, for owner and machine-account PRs alike.

The gate therefore lives in the workflows instead: `ecc-review` (required) passes for non-trusted authors only after the owner's `/ecc-review`, and auto-merge is enabled only for trusted authors, so the owner merges every other PR by hand.

**Considered and not implemented:** a second ruleset with only a `pull_request` rule (`required_approving_review_count: 1`, `require_code_owner_review: true`) and the admin role as a bypass actor in `pull_request` mode. Non-admins would then need the owner's approval, while the owner could merge their own PRs by bypassing. It was rejected:
- the bypass is a manual "merge without waiting for requirements" by the admin; auto-merge (enabled by the workflow token) does not use it, so the owner's PRs would lose auto-merge;
- machine-account PRs (trusted) would also need a manual approval;
- it reintroduces an admin bypass, which the project deliberately avoids.

Reconsider it if a second maintainer joins.

### 7. Forks remain refused by `ecc-review`

Running the review on fork heads after an owner approval would put fork content into a job that holds the Claude credential and a write token. It is read as data only, but it is still a larger surface for a rare case. The existing flow stays:
1. the owner approves the fork's CI run (decision 5) and reads the diff;
2. the owner re-pushes the commits to a branch here;
3. that PR is the owner's, so it is reviewed and merged normally.

### 8. Policy enforcement

`PRIVILEGED[<file>].authorGate` in `workflow-policy.mjs` declares, per gated workflow, the job, the exact step name, its index, its `id` (auto-merge), the exact `env` map and either:
- `failClosed`: the run has an `exit 1` line; or
- `guardsLaterSteps`: every later step's `if` is exactly `steps.author.outputs.trusted == 'true'`.

The policy fails if:
- the gate is missing, moved or renamed;
- it gains an `if`, a `uses` or a `working-directory`;
- its inputs change;
- a later auto-merge step loses the guard.

The run-step digests (`privileged-run-steps.json`) pin the script text itself. `checkGithubDir` also validates `trusted-authors.json` whenever a gated workflow exists.

## Threat model

| # | Threat | Mitigation | Residual |
|---|---|---|---|
| T1 | A non-trusted same-repo author (Write role) burns the Claude credential with many pushes | The gate fails before any credential use, checkout or model call | Runner seconds per push |
| T2 | A fork author runs code in CI | `all_external_contributors` approval (decision 5); `ecc-review` and `auto-merge` refuse forks; `pull_request` gets no secrets | The owner must read a fork diff before approving its CI run |
| T3 | A non-owner forges approval: a `/ecc-review` comment, **editing an owner comment**, a UI re-run, a label, or editing `trusted-authors.json` or the workflows in the PR | `rerun` requires `OWNER`; the gate re-checks login and association and requires an unedited comment; labels play no part; the list and workflows come from `main` | None found after the fixes for H1 |
| T4 | Approval replay: onto a new push, onto an older commit pushed back, or by repeated UI re-runs | The approval names a head-SHA prefix, must be newer than the run's event, and must be one per attempt | — |
| T5 | Race: the author pushes Y between the owner reading X and commenting | The approval names X, so it does not approve Y's run | — |
| T5b | A non-trusted Write user pushes to a trusted author's PR | The sender must be trusted too; auto-merge re-checks on `synchronize` | — |
| T5c | **An approved review is effectively a merge approval.** `main.json` requires 0 approvals, so a same-repo author with Write can merge once `ecc-review` and `ci-ok` pass. Before `apply.sh --with-ecc-review --apply`, only `ci-ok` is required, and this gate gates the credential spend, not the merge | `/ecc-review <sha>` is documented as "I read this commit and accept it". Write is granted only to the machine account, which is trusted. Apply `--with-ecc-review` once the secret exists | Owner discipline; reconsider decision 6 if outside collaborators ever get Write |
| T5d | A Write user pushes a branch with a new `on: push` workflow that reads repository secrets (for example `CLAUDE_CODE_OAUTH_TOKEN`), which bypasses this gate. This is not introduced by this change | The machine account's token has no Workflows permission (`docs/agent-account.md`), so it cannot push workflow files. No other account has Write | Follow-up: move the Claude credential into an environment limited to `main`/PR events, if Write is ever widened |
| T6 | Trusted-list tampering through a merged PR (for example by the machine account once trusted) | A listed login gains nothing without the Write role, which only the admin grants; the policy validates the file; CODEOWNERS; ECC review flags `.github/` changes for the security reviewer | — |
| T7 | Skipped check treated as passing | The gate never skips; the job-level `if` of `review` is unchanged (draft PRs only) | — |
| T8 | API error or malformed list | `set -euo pipefail`, assignment from the pipeline; any failure fails the step (`ecc-review`) or leaves auto-merge off | — |
| T9 | Repository transfer to an organization changes `github.repository_owner` | `prix0007` is in the list, so PRs stay trusted; the `/ecc-review` approval (owner login and association) needs the follow-up change already called for in `docs/agent-account.md` | Approvals stop working until that follow-up |
| T10 | Dependabot PRs | Untrusted (bots cannot be listed); the owner comments `/ecc-review`; never auto-merged (unchanged) | One comment per Dependabot PR |
| T11 | `pull_request_target` pitfalls | Unchanged: no PR code is executed; head checked out only into `pr/` as data, after the gate; credentials never persisted; agent config restored from base | — |

## Security review

Done by the change author; an independent `security-reviewer` pass is recorded below.

**Scope.** The gate steps and their placement, the trusted-list read, approval freshness, the policy enforcement, `apply.sh` fork-approval sync, and the `pull_request_target` invariants.

**Checks performed:**
1. **No expression reaches `run:`.** Every `${{ }}` in the new steps is in `env:`. actionlint and zizmor (pedantic) are clean.
2. **Ordering.** In `review`, the gate is step 2. The credential check, all three checkouts, bubblewrap and the model come after it. The policy test proves that moving the gate after a checkout fails.
3. **Fail-closed paths:**
   - owner → pass;
   - listed → pass;
   - owner comment newer than the event → pass;
   - anything else, any API or JSON error, a missing file or a non-array → step fails (`ecc-review`) or `trusted=false` (`auto-merge`).

   The jq filter errors (exit 5) on a non-array instead of reading it as "not listed", so a corrupted list is visible.
4. **Approval integrity.** The `rerun` job condition is unchanged (owner-only, comment-only, no actions). The gate re-checks login and association itself, so a manual re-run by a Write user cannot pass.
5. **Least privilege.** No permission was added to any job. `review` keeps `contents: read` and `pull-requests: write`; `auto-merge` keeps `contents: write` and `pull-requests: write`.
6. **apply.sh.** The fork-approval body is a committed file passed with `--input` (no interpolation). A dry run never writes. The re-check after `--apply` covers it. A failing write fails the script (existing test).
7. **Digests.** Only the two new gate steps were pinned. The auto-merge enable step gained an `if:` but its run text, and therefore its digest, is unchanged.

**Independent review (security-reviewer agent, 2026-10-06): CHANGES REQUESTED, then fixed in this change.**

| Finding | Fix |
|---|---|
| H1: a Write user can edit an owner comment into `/ecc-review` (edits keep login, association and `created_at`) | Approvals must be unedited (`updated_at == created_at`); test "edited, e.g. by a Write user" |
| H2: trust was by author only; a non-trusted push to an owner PR was reviewed and stayed auto-merged | Both author and sender must be trusted; `synchronize` added to auto-merge; tests for both gates |
| H3: approvals were not bound to a commit (force-push replay) and UI re-runs could repeat the spend | `/ecc-review <sha>` must prefix the run's head SHA; approvals ≥ `max(1, run_attempt - 1)`; tests for replay, wrong SHA and attempts |
| H4: the digest was stale after an edit | Re-pinned once, after all fixes, from the reviewed text |
| M1: the threat model overstated "owner merges by hand" and missed branch-workflow secret access | Rows T5c and T5d added |
| L1: an API failure left manually enabled auto-merge on | It is now switched off before the step fails |
| L2: `working-directory` on the gate was not policed | The policy forbids it (`shell:` was already forbidden) |
| L3: an empty `PR_UPDATED_AT` would accept any comment | `${PR_UPDATED_AT:?}` and `${HEAD_SHA:?}` fail the step |

The reviewer confirmed:
- no `${{ }}` in `run:`;
- the gate is placed before every secret, checkout and model use;
- `x=$(a | jq …)` under `set -euo pipefail` fails the step;
- the jq lookup matches whole logins only;
- pagination is correct;
- `apply.sh` dry runs never write, and the re-check works.

The jq was also written so that it trips nothing in the policy's "executes the checkout" denylist (no `. as $x`, which reads like a shell `. file`). The denylist was left as it is.

**Status:** all findings addressed. 350/350 tests pass, and the policy, actionlint, zizmor (pedantic), shellcheck and `openspec validate --all --strict` are clean. A re-review by the overwatcher's security reviewer on the PR is still expected (ECC review on `.github/**`).

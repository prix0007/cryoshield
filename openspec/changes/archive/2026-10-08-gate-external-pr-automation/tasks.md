# Tasks

> **Archive after:** adopt-ecc-review-and-auto-merge (MODIFIED requirements; see the proposal).

## 1. Workflow policy and gates (tests first)

- [x] 1.1 Write `test/author-gate.test.mjs` first. It must show that the policy fails when:
  - the `ecc-review` gate is removed, renamed, moved after a checkout or the credential step, given an `if:`, has its `env` inputs changed, or loses its `exit 1`;
  - the `auto-merge` gate is not first, loses `id: author`, or the enable step loses `if: steps.author.outputs.trusted == 'true'`;
  - `trusted-authors.json` is not an array, is empty, has a bot, a wildcard, a duplicate or a non-string;
  - and it must show that the committed files pass.

  Also add a behavioural test that runs each gate script with a stub `gh`, covering:
  - owner → pass;
  - listed (case-insensitive) → pass;
  - unlisted → fail with "Awaiting owner approval";
  - owner `/ecc-review` newer than the event → pass;
  - older comment, non-owner comment or a `COLLABORATOR` association → fail;
  - API error or malformed list → fail closed.

  Then add `authorGate` to `PRIVILEGED` in `workflow-policy.mjs`, add `checkTrustedAuthors`, the gate steps in `ecc-review.yml` and `auto-merge.yml`, and `.github/trusted-authors.json`. Verify with `npm test --prefix .github/scripts` and `node .github/scripts/workflow-policy.mjs .github`.
- [x] 1.2 Re-pin the new privileged run steps in `privileged-run-steps.json` (`workflow-policy.mjs --digests`) after reading each diff, and update the `dangerous-triggers` lines in `zizmor.yml` if the `on:` lines moved. Verify that actionlint and `uvx zizmor==1.30.1 --offline --persona=pedantic --config .github/zizmor.yml .github` are clean.

## 2. Fork PR approval as code (tests first)

- [x] 2.1 Extend `test/fixtures/gh-stub.sh` (GET/PUT `actions/permissions/fork-pr-contributor-approval`) and add tests to `test/apply-sh.test.mjs` first, covering:
  - drift in a dry run → diff, exit 3, no write;
  - `--apply` → one `PUT ... --input fork-pr-approval.json`, re-check in sync;
  - in sync → no write.

  Then add `.github/rulesets/fork-pr-approval.json` and `sync_fork_approval` in `apply.sh`. Verify with `npm test` and shellcheck.

## 3. Docs

- [x] 3.1 Update:
  - `CLAUDE.md` "Change flow" (trusted authors, `/ecc-review` approval, auto-merge only for trusted authors, fork approval);
  - `README.md` Contributing;
  - `docs/agent-account.md` (add the machine account to `.github/trusted-authors.json` when it is created);
  - the CODEOWNERS header comment.

  There is no `CONTRIBUTING.md`, so nothing to update there. Verify that the commands match `apply.sh` usage.

## 4. Integration

- [x] 4.1 Run the full set and verify all are green:
  - `npm test --prefix .github/scripts`;
  - the workflow policy;
  - actionlint;
  - zizmor pedantic;
  - shellcheck on `apply.sh` and the stub;
  - `openspec validate --all --strict`.

## 5. Security review

- [x] 5.1 Security review of this change (CI touches secrets), covering:
  - gate bypass (labels, re-runs, forged comments, PR-side list edits, skipped checks);
  - gate placement before any secret, checkout or model use;
  - approval freshness;
  - fail-closed paths;
  - `pull_request_target` invariants;
  - the `apply.sh` write path.

  Verify by recording the findings and fixes, or an APPROVE, in `design.md` → "Security review".

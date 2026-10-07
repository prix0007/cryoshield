# Design

## Context

CodeQL flagged two places in CI code:
- **#3:** a regex-based HTML-comment strip in the triage comment composer;
- **#1:** a PR-head checkout at the root of the `pull_request_target` review job.

The triager proved that #3 can be exploited.

## Decisions

### 1. Escape, don't strip (#3)

A strip has to anticipate every way a parser can see a comment: `--!>`, unterminated comments, delimiters re-formed after removal. Escaping `<` and `>` turns all of them into text in one step.

We don't escape `&`. An agent-written `&lt;!--` renders as the visible characters `<!--`, which is not a comment.

The marker name prefix is also broken up, so no marker text appears in the agent's part at all, not even inert. The parser already only counts markers after the footer, so that check stays as a second layer.

**Cost:** HTML that the agent wrote (for example `<details>`) and Markdown blockquotes (`>`) are now shown literally. That is acceptable for a short diagnosis.

### 2. Base at the root, PR in `pr/` (#1)

- The root checkout is `base.sha`, with `persist-credentials: false`. Claude Code's settings (`.claude/`), `CLAUDE.md`, `.mcp.json` and the action's working-directory reads now come from reviewed code.
- The PR head goes to `pr/` with `fetch-depth: 0`, so `git -C pr cat-file` can see `BASE_SHA`.
- The restoration runs in `pr/`. Claude Code loads `CLAUDE.md`-style memory files from directories it reads, so nested ones under `pr/` are covered as well. Each is replaced by the base commit's version, or removed if the base has none. This was simulated on a throwaway repository: top-level and nested files were restored or removed, and code and look-alike names were untouched.
- `Read`, `Grep` and `Glob` of `./pr/.git/**` are denied, like `./.git/**`.
- The policy pins the layout. A `head.sha` checkout must have `path: pr`, and a `base.sha` checkout must have no path.

**Alternative:** no checkout of the PR at all, with the reviewer working from the diff only. Rejected because reviewers need the surrounding code.

## Risks / Trade-offs

- **CodeQL may still flag #1.** The query looks for a head checkout in `pull_request_target` followed by a step that could execute it. The checkout stays (it is needed), but nothing at the root comes from the PR any more, and no step executes `pr/`. If the alert stays open after merge, dismiss it as "won't fix" and link this design.
- Paths in the diff are relative to the repository root, while files are under `./pr/`. The prompt says so.

## Security review (task 4.1)

**Reviewer:** the security-reviewer agent, read-only, 2026-10-05. **First pass: CHANGES REQUESTED. Re-review of 9231820: APPROVE**, with one LOW, which has also been fixed.

The reviewer confirmed:
- the escaping gives no route to a comment, a tag or a counted marker;
- nothing PR-controlled sits at the workspace root;
- ref and path variants of the checkouts are refused;
- the triage profile is unchanged.

| # | Finding | Resolution |
|---|---|---|
| M1 | Restore step: a path containing a newline was split by the line-based pipeline, so a nested `CLAUDE.md` could escape the restore. | The `git ls-files -z` output is checked first. A PR with a newline in any path fails the step, so it is not reviewed automatically. Simulated on a throwaway repository. |
| L1 | `|| true` also hid a failing `git ls-files`. | `ls-files` now runs on its own under `set -e`. Only grep's no-match exit (1) is tolerated. |
| L2 | The credential check passed when a checkout was missing. | `git -C "$d" rev-parse --git-dir` runs first. |
| L3 | The policy did not check the number or order of checkouts. | The policy now requires exactly one base checkout, then one head checkout into `pr/`, both before the restore step. Tests added. |
| L4 | Pre-existing: an unbalanced backtick closed a mention's code span early, and link reference definitions hid text. | Backticks are escaped (`&#96;`) and `]:` is escaped (`]&#58;`). Tests cover list-item labels, escaped brackets and two-line labels. |

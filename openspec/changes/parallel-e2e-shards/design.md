# Design: parallel-e2e-shards

## D1. Split by project, not by Playwright `--shard`

Each shard owns whole projects. This keeps the analytics build on the desktop shard only, and keeps a failure easy to
read: the job name says whether desktop or phone failed. Playwright's `--shard=i/n` would split specs by file
order and need both preview servers on both runners.

## D2. Shard selection

`PW_PROJECTS` carries the project list per matrix entry. The job passes it as repeated `--project` flags, so
`playwright.config.ts` needs no knowledge of CI. The config checks `process.argv` for `--project` and skips the
4174 analytics `webServer` when `analytics` is not among the selected projects. With no `--project` flag, both servers
start, as before.

## D3. Gate

`fail-fast: false`, so one shard failing does not cancel the other and both report. `ci-ok` keeps `web-e2e` in
`needs`. For a matrix job, `needs.web-e2e.result` is `failure` if any entry fails, so the gate is unchanged.

## D4. Security review

This changes only CI scheduling. The new matrix values are fixed literals in the workflow, not PR-controlled input.
No new action, secret, permission or token is added, and `permissions: contents: read` is unchanged. `zizmor` and
`actionlint` run in `workflow-lint`.

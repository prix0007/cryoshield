# Design

## Context

See `proposal.md` → Why. Three independent, small edits share one change because each is a record-keeping move
that the incident sweep surfaced together, and each has a check that fails before and passes after:

- `pnpm audit` on the workspace reports GHSA-p458-7748-mcp3 twice (via `@vitest/browser` and `@vitest/ui`, both
  pulled in by `vitest@5.0.3`); `vitest run` is the only mode CI uses, Browser Mode runs headless in
  `packages/vault-crypto` on developer machines and in CI.
- `npm audit` in `.github/openspec-cli` reports `braces` (HIGH) through `@fission-ai/openspec@1.14.0`; osv-scanner and
  Trivy pass only because of the exception entries, which `.github/scripts/osv-gate.mjs` and `trivy-gate.mjs`
  require to expire and to be mirrored in the README.
- `node apps/web/scripts/beacon-drift.mjs` exits 1: live `sha384-DSBfgE0some…` (2026.10.1, 31,853 bytes) vs committed
  `sha384-IJ+SAOzs…` (2026.10.0, 31,679 bytes). The lock is read by the Vite analytics plugin (emits the `integrity`
  attribute), `verify-build` (checks the emitted attribute equals the lock) and `analytics-checks.test.ts`.

## Goals / Non-Goals

**Goals:** the Vitest and beacon checks pass; the `braces` move is attempted and its outcome recorded; every exact pin
stays exact; the README table and the two ignore files agree; the beacon review follows the published procedure and is
recorded in the lock.

**Non-Goals:** changing test modes or configs, adding a `server.fs.deny` workaround, touching the Caddy exceptions,
upgrading developers' global `openspec`, or deciding the self-hosting question (D4a) for the beacon.

## Decisions

### D1. Upgrade Vitest everywhere it is pinned, in one lockfile move

`pnpm --filter … add vitest@5.0.5 --save-exact` for the three packages plus `@vitest/browser-playwright@5.0.5` in
`vault-crypto`. pnpm resolves one version of each `@vitest/*` package. Alternative rejected: setting
`server.fs.deny` in each Vitest config (the advisory's workaround), because the fix exists and a workaround would
have to be maintained forever. `@testing-library/jest-dom@7.0.1` pulls `vitest` as a peer and follows the lockfile.

### D2. The CI OpenSpec pin stays at 1.14.0; the `braces` exception stays, with its reason updated

1.14.3 drops `braces`, and the bump was applied and tested: `package-lock.json` lost `braces`, `micromatch` and
`fast-glob`, and `npm audit` went clean. It was then reverted because `openspec validate --all --strict` with 1.14.3
reports 84 warnings, every one "Requirement text is very long (>500 characters)", across 19 main specs
(`ci-pipeline` 7, `vault-crypto` 7, `landing-page` 6, `continuous-deployment` 5, `contribution-workflow` 4,
`vault-web-app` 3, `vault-recovery` 3, `web-hosting`, `project-readme`, `issue-triage`, `app-motion` 2 each,
`supported-devices`, `hardware-key-auth`, `donation`, `deployment-targets` 1 each) and 9 in-flight changes
(`vault-list-labels-archive` 6, `recover-registry-versions` 2, `web-review-followups`, `vault-view-action-layout`,
`trim-landing-cta-audit-note`, `reload-on-new-build`, `release-recovery-tool-assets` 1 each). 1.14.1 made that a
warning and `--strict` fails on warnings; the CI `openspec` job runs exactly that command and also asserts the
version. There is no intermediate release: 1.14.1 and 1.14.2 have the rule and still carry `braces`.

Splitting 84 requirements is a spec-wide edit that needs its own review, so it is a follow-up change, tracked as
issue #128 (lists every affected spec and change, and the steps). Alternatives
rejected: dropping `--strict` in CI (weakens every other check); an npm `overrides` for `braces` (no fixed version
exists to override to); keeping the bump and the red CI job. Until the follow-up lands, the exception keeps its
2026-12-31 expiry, and the README row and the TOML comment say what the fix is and what blocks it, so the next
reviewer does not re-discover it.

### D3. Beacon 2026.10.1 is accepted; the lock records the review

Procedure from `apps/web/analytics/README.md`, run 2026-10-22. Previous bytes: Wayback capture
`20261001000800id_` of `static.cloudflareinsights.com/beacon.min.js`, gunzipped to 31,679 bytes whose SHA-384 equals
the committed pin exactly. Both files pretty-printed with prettier 3.6.2 (`--parser babel`): 1,946 → 1,953 lines,
103 changed lines.

What changed:
- **LCP attribution:** the matching resource entry must now also start before the LCP entry (`requestStart ||
  startTime <= lcp.startTime`); variables renamed. Timing data only.
- **UA parser:** the WebKit branch matches `AppleWebKit/` alone (previously also `Safari/`), and when the existing
  version regexes miss it derives the iOS version from `navigator.userAgent` with a new regex. Same data source as
  before, a different parse of it.
- **Navigation API hook:** restructured; it now returns early for same-document navigations to the current URL
  (`t.destination.url === window.location.href`, the one new `location.href` read). The hook is installed only when
  `window.__cfBeacon.spa` is not `false` (lines 1207 and 1927 of the pretty-printed file, unchanged from 2026.10.0);
  we set `spa:false`, so it never runs for us.
- **Version strings** `2026.10.0` → `2026.10.1` in both payload fields.
- One statement reordered (a flag is set before the callback instead of after).

What did not change, verified by grepping both files with the same pattern list: no `innerHTML`, `outerHTML`,
`insertAdjacentHTML`, `document.write`, `eval(`, `new Function`, `WebAssembly`, string timers; no `document.cookie`,
`localStorage`, `sessionStorage`, `indexedDB`, Cache API; no `createElement` or `setAttribute`; no `querySelector`
beyond the two pre-existing ones; the only network destination is still `https://cloudflareinsights.com/cdn-cgi/rum`
via `sendBeacon` / `XMLHttpRequest`; the same `navigator.userAgent`, `navigator.userAgentData`, `PerformanceObserver`,
`performance.*`, `document.referrer` and `location.*` reads (plus the one `location.href` above). `__cfBeacon`
precedence as reviewed on 2026-10-08 (no inline script can set it under our CSP). No new data is read from the page,
so `/privacy` and `/cookies` need no update.

Alternative rejected: leaving analytics off until the human sign-off (6.1). The lock already says that sign-off is
pending and the pin is the same mechanism; delaying only loses aggregate data without reducing risk.

### D4. Records

- `README.md` "Known vulnerabilities": the `braces` row's severity column drops "no fix" and its reason names the fix
  and the blocker; the "As of" line is re-dated to 2026-10-22 (the Caddy rows remain).
- `.github/osv-scanner.toml` keeps its entry, gains a dated note naming the fix and the blocker, and its `reason` no
  longer says "no fix released". `trivyignore.yaml`'s `braces` comment and `statement` say the same (a wording change
  to an exception file; recorded in the security-review table, row 2).
- `beacon.lock.json`: `sha384`, `bytes` 31853, `version` "2026.10.1 (ETag W/"2026.10.1", Last-Modified Thu, 15 Oct 2026
  18:26:54 GMT)", `reviewedAt` 2026-10-22, `reviewNotes` summarising D3; `reviewedBy` still says the human sign-off is
  pending, now for both versions and pointing at `apps/web/docs/security-review-analytics.md`, which gains a
  2026.10.1 entry.

## Threat / abuse

No crypto, contract or paymaster path changes. Supply chain only:

- **Tampered package:** pnpm installs from lockfile integrity hashes with install scripts disabled
  (`pnpm.onlyBuiltDependencies: []`); `npm ci --ignore-scripts` for the CI tool. Vitest 5.0.5 and OpenSpec 1.14.3
  were published 2026-10-15 and 2026-10-17, over Dependabot's 7-day cooldown, and the Shai-Hulud marker files
  (`setup.mjs`, `Math_Symbol.js`, `preinstall` hooks) are absent from the installed trees (re-checked after install).
- **Beacon:** the pin moves from one reviewed byte string to another; SRI still refuses anything else. A future
  Cloudflare change turns analytics off again rather than running unreviewed code. The landing CSP is unchanged.
- **Keeping the `braces` exception** leaves a CI-only stack-exhaustion DoS reachable only through glob patterns written
  in this repository; the exception still expires on 2026-12-31 and the gates still fail on anything else.

## Security review (2026-10-22)

| # | Area | Check | Result |
|---|---|---|---|
| 1 | Supply chain | Exact pins `5.0.5`; one version of each of the seven `@vitest/*` packages in the lockfile; integrity hashes; `pnpm install --frozen-lockfile` clean; no install scripts; no `setup.mjs`/`Math_Symbol.js`/`preinstall` in the installed Vitest trees; `pnpm audit` 0 findings | Pass |
| 2 | CI tool | 1.14.3 attempted: lockfile free of `braces`, `npm audit` clean, but `validate --all --strict` fails 84 items; reverted to 1.14.0; README row, TOML `reason` and trivyignore `statement` reworded (no longer "no fix released"); `npm test --prefix .github/scripts` 442/442 and `trivy-gate.mjs` README mirror check pass | Held (D2) |
| 3 | Beacon | Diff against the exact previous bytes; sink/storage/network grep identical; `spa` gate unchanged; CSP unchanged; `beacon-drift.mjs` exits 0 | Pass (D3) |
| 4 | Behaviour | `web` 107 files / 1,563 tests, eslint and tsc clean, `verify-build` PASS (beacon pinned to the lock, `/app` +20,265 B of +20,480 B); `vault-crypto` 381 Node tests with typecheck and 370 Browser Mode tests; `metrics` 55 tests and tsc clean; analytics E2E 9/9 | Pass |

## Risks / Trade-offs

- [Vitest 5.0.5 changes test behaviour] → patch release; the three unit suites and Browser Mode run before the push,
  and CI runs them again.
- [OpenSpec 1.14.3 `--strict` flags warnings 1.14.0 did not] → realised: 84 warnings, none trivial; the pin is held at
  1.14.0 (D2) and the follow-up change, issue #128, is the fix, due before the exception expires on 2026-12-31.
- [Beacon review is agent-run] → recorded in the lock, in `apps/web/docs/security-review-analytics.md` ("Beacon
  re-reviews") and here, with the exact prior bytes identified by hash; the human security-reviewer sign-off is still
  pending for 2026.10.0 and 2026.10.1, and the lock's `reviewedBy` says so.

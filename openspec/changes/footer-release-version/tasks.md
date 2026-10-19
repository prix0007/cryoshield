# Tasks

## 1. Tests first

- [x] 1.1 `apps/web/deploy/test/release-manifest.test.ts`: `--release v1.2.3` is recorded as `release` after
  `commit` in the manifest and in `site/release.json`; absent, it is `null`; `--release 1.2.3` throws.
- [x] 1.2 `apps/web/deploy/test/deploy-sh.test.ts`: production passes `--release <tag>` from the tag at `HEAD`, or
  from `GITHUB_REF_NAME` when `GITHUB_REF_TYPE=tag`; refuses no tag, two tags, a malformed name; development never
  passes `--release`.
- [x] 1.3 `.github/scripts/test/deploy-scripts.test.mjs`: smoke passes on production with a tag name and on
  development with `null`; fails on production `null`/malformed/`EXPECT_RELEASE` mismatch and on development with a
  name; derives the expectation from `GITHUB_REF_TYPE=tag`; rejects a malformed `EXPECT_RELEASE` (exit 2).
- [x] 1.4 `apps/web/test/lib/release.test.ts`: `parseRelease` accepts only the documented shape; `releaseLink`
  labels and links a tag and a dev commit; `fetchRelease` returns `null` on 404, non-JSON, timeout and rejection.
- [x] 1.5 `apps/web/test/landing/release.test.ts`: the `Version` line stays hidden without a valid response and
  shows the label and link with one; parity with `lib/release.ts` on the same inputs.
- [x] 1.6 `apps/web/test/ui/release-tag.test.tsx`: the app footer shows the line from the `release` service and
  nothing when it resolves to `null`.

## 2. Implementation

- [x] 2.1 `release-manifest.mjs`: `--release` (D1).
- [x] 2.2 `deploy.sh`: production names its release, development does not (D2).
- [x] 2.3 `smoke.sh`: per-target `release` check and `EXPECT_RELEASE` (D3).
- [x] 2.4 Landing: `index.html` line, `src/landing/release.ts`, wired in `main.ts`, styles (D4, D5).
- [x] 2.5 App: `src/lib/release.ts`, `release` service (lazy), `ReleaseLine` in `AppFooter`, styles (D4, D5).
- [x] 2.6 Docs: `apps/web/deploy/README.md` and `docs/deploy.md` describe the field and the footer line.
- [x] 2.7 Spec deltas: `web-hosting`, `continuous-deployment`, `landing-page`, `vault-web-app`.

## 3. Verification

- [x] 3.1 `pnpm --filter @cryoshield/web test`, `test:deploy`, `lint`, `typecheck`, `verify-build`;
  `npm test --prefix .github/scripts`; `openspec validate --all --strict`.

  2026-10-20: the six new test groups failed first (missing modules, no `--release`, no smoke check), then passed:
  web 106 files / 1,533 tests; deploy 128; CI scripts 442; eslint and tsc clean; `verify-build --real-env` PASS,
  `/app` initial 207,840 B (+20,319 of +20,480 B; `main` 207,707 B), landing initial 3.88 KB / 15 KB; OpenSpec 49
  items valid.

## 4. Review

- [x] 4.1 Security review recorded in `design.md` (Threat / abuse).

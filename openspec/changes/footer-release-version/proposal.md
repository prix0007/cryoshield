# Proposal

## Why

Nothing on the site says which release is running. `/release.json` names the commit and tree hash, but a visitor or
a support thread has to curl it and map the commit to a tag by hand. The founder asked (2026-10-19) for the release
version "in view in the footer, like current version" on both the landing page and `/app`.

The bundle cannot carry the version itself: the deployed build must stay a pure function of the commit (anyone
rebuilds the tagged commit and compares `treeHash`, `web-build-integrity`), and a tag is not part of the commit.
`/release.json` is written at deploy time, is excluded from the tree hash and is served `no-store`, so it is the one
place the release name can live without changing the build. Both footers read it at runtime.

## What Changes

- `apps/web/deploy/deploy.sh`: a production build names its release: the run's own tag in Actions (`deploy.yml` runs
  at the `v*` tag ref, `GITHUB_REF_TYPE=tag`), or the single `v*` tag at `HEAD` locally. No tag, several tags or a
  malformed name refuses the build. A development build never names one.
- `apps/web/deploy/release-manifest.mjs`: `--release <tag>` writes `release` (the tag, or `null`) into the manifest
  and into `site/release.json`, after `commit`.
- `.github/scripts/deploy/smoke.sh`: on production `/release.json` `release` must be a `vX.Y.Z[-pre]` name and, when
  the run is at a tag (or `EXPECT_RELEASE` is set), that exact name; on development it must be `null`.
- Landing page: a `Version` line at the end of the footer, hidden until the page has fetched `/release.json` and
  validated it; it links the tag to the GitHub release, or on development the short commit to the commit page.
- `/app`: the same line in the app footer, fetched lazily through the services container so the initial `/app`
  JavaScript does not grow.
- `vite dev` and `vite preview` answer `/release.json` with the checked-out commit and `release: null`, so the
  footers work locally and in E2E and no page logs a 404 for the fetch (server middleware; the build is unchanged).
- Specs: `web-hosting` (release identity carries `release`), `continuous-deployment` (smoke test checks it),
  `landing-page` and `vault-web-app` (the footer line).

## Out of scope

- The legal and documentation pages (`/privacy`, `/terms`, `/cookies`, `/architecture`, `/devices`, `/support`,
  `/lost-key`): they load no script by design (`architecture-page`), so they cannot fetch `/release.json`.
- Passing the tag through the workflows (`deploy.yml`, `deploy-dev.yml`): not needed, the scripts read the run's
  own ref, and workflow files are owner-pushed.
- Any "new version available" behaviour: `reload-on-new-build` owns that and compares module entry scripts, not the
  release name.
- The recovery tool's version; it already prints its own.

## Runtime dependencies

None added. The footers make one same-origin `GET /release.json` (already allowed by `connect-src 'self'`) to the
static site. Nothing is operated by CryoShield beyond the existing static host.

## Capabilities

### Modified Capabilities
- `web-hosting`: the public release identity names the release tag (production) or `null` (development).
- `continuous-deployment`: the smoke test verifies the release name per target.
- `landing-page`: the footer shows the release.
- `vault-web-app`: the app footer shows the release.

## Impact

- **Changed:** `apps/web/deploy/deploy.sh`, `apps/web/deploy/release-manifest.mjs`, `.github/scripts/deploy/smoke.sh`,
  `apps/web/index.html`, `apps/web/src/landing/{main,release}.ts`, `apps/web/src/lib/release.ts`,
  `apps/web/src/ui/{App.tsx,chrome.tsx,services.tsx,useRelease.ts}`, `apps/web/src/landing/landing.css`, `apps/web/src/ui/global.css`,
  `apps/web/vite.config.ts`, `apps/web/vite-plugins/release-preview.ts`, `apps/web/deploy/README.md`, `docs/deploy.md`, the four specs.
- **Tests:** `apps/web/deploy/test/{deploy-sh,release-manifest}.test.ts`, `.github/scripts/test/deploy-scripts.test.mjs`,
  `apps/web/test/landing/release.test.ts`, `apps/web/test/lib/release.test.ts`, `apps/web/test/ui/release-tag.test.tsx`,
  `apps/web/test/build/release-preview.test.ts`, `apps/web/e2e/specs/23-release-version.spec.ts`.
- **CI:** `web`, `web-e2e` (footer link reachability on `/`), `ci-scripts` (`npm test --prefix .github/scripts`).
- **Pipelines:** the next dev deploy serves `"release": null`; the next owner release serves its tag. Until then the
  live sites serve no `release` field and the footers simply stay without the line.

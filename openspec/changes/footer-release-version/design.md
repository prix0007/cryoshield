# Design

## Context

`/release.json` is produced by `release-manifest.mjs` at deploy time from the built site and the commit, published
into the site after the tree hash is computed, and served `no-store` with every security header (`web-hosting`
"Public release identity"). The `reload-on-new-build` design already rejected embedding the commit in the bundle:
every commit would change every chunk hash. A tag is worse: it is not even part of the commit, so a bundle that knew
its tag could not be rebuilt from the commit alone, which breaks the published rebuild check.

## Decisions

### D1. The release name lives in `/release.json`, never in the bundle

`release-manifest.mjs` takes `--release <tag>`; the field `release` is the tag string on production and `null`
elsewhere. It sits in the manifest and in `site/release.json`, right after `commit`, and is never part of `treeHash`
(release.json is excluded already). The build output is unchanged by this change for a given commit, so the dev and
production builds of one commit still share a tree hash, and "tree unchanged" detection in the dev pipeline keeps
working.

### D2. Where the tag comes from

`deploy.sh` (production target only):
1. In Actions, `deploy.yml` runs **at** the tag ref (release event or dispatch), so `GITHUB_REF_TYPE=tag` and
   `GITHUB_REF_NAME` is the tag. The build job checks out by SHA (`needs.detect.outputs.sha`), which carries no tag
   objects, so `git tag --points-at HEAD` would be empty there. The `detect` job already resolved that tag to the SHA
   being built and the release job re-checks it right before `fly deploy`, so the name is trustworthy in that run.
2. Locally (an owner's manual `deploy.sh`), the tags are present: `git tag --points-at HEAD --list 'v*'`.

The result must match the pipeline's tag grammar (`release-ref.sh`): `vMAJOR.MINOR.PATCH` with an optional
`-prerelease`. No tag, two tags at `HEAD`, or a malformed name **refuses the production build** rather than
publishing a site without a release name. A development build passes no `--release`: dev is never a release, even
when `main`'s HEAD happens to be tagged, and the footer shows the commit instead.

Rejected: a `RELEASE_TAG` input or workflow env. The workflows are owner-pushed, the information is already in the
run's ref, and a free-form input would be one more thing the tag re-check must cover.

### D3. The smoke test verifies the name per target

`smoke.sh` reads `release` from the live `/release.json`:
- development (`EXPECT_NOINDEX=true`): must be `null`; a dev site claiming a release name fails and rolls back;
- production: must match the tag grammar, and must equal `EXPECT_RELEASE` when set. `EXPECT_RELEASE` defaults to
  `GITHUB_REF_NAME` when `GITHUB_REF_TYPE=tag`, which is every production run, so the live site always has to name
  the tag the run deployed; a malformed `EXPECT_RELEASE` is a usage error (exit 2), never a skipped check.

### D4. Footers fetch at runtime, validate strictly, fail silent

Both footers carry a `Version` line that is hidden in the HTML and shown only after a successful fetch:
- `GET /release.json` from the page's own origin, `cache: 'no-store'`, `credentials: 'same-origin'`, 4 s timeout;
- the body must be an object whose `commit` is 40 lower-case hex and whose `release` is `null` or a tag matching the
  grammar above; anything else (a 404 from a host that does not publish the file, a non-JSON body, an unexpected
  shape) leaves the line hidden;
- the line's text and link are built from the validated values only, with `textContent` and `href`, never HTML;
  the CSP's Trusted Types requirement is untouched (no `innerHTML`, no `DOMParser`).

Production shows `Version v1.0.3`, linking to `https://github.com/prix0007/cryoshield/releases/tag/v1.0.3`.
Development shows `Version dev 45cb4c7` (the 7-character commit), linking to the commit page. Both links open in the
same tab with `rel="noopener noreferrer"`, like the other footer links. A missing line is the honest state: the page
does not know, and says nothing.

### D5. Two small modules, not one shared chunk

`verify-build` fails when `/app` and the landing page share any chunk beyond the preload helper and the theme
script. A module imported by both pages would become exactly such a chunk. The parsing and labelling therefore live
in `apps/web/src/lib/release.ts` for the app and in `apps/web/src/landing/release.ts` for the landing page (its own
copy, with the DOM wiring), and a parity test feeds both the same inputs and expects the same label and link. The app
imports its module lazily from `services.tsx` (`release: () => import('../lib/release')...`), so the initial `/app`
JavaScript, which has about 370 B of headroom under the `app-motion-ux` budget, does not grow; the footer line
renders when the chunk and the fetch resolve. The landing module is a static import of `main.ts`: the landing initial
budget has ample room (3.9 KB of 15 KB).

The shell owns the fetch: `App.tsx` calls `useRelease(svc.release)` and passes the label to `AppFooter`, which stays
presentational. Measured 2026-10-20: making `chrome.tsx` read the services container itself re-split viem out of
the `/app` entry into four shared chunks (`errors`, `localBatchGatewayRequest`, `secp256k1`, `utils`), +3.8 KB gzip
on the initial graph and over budget, although no module was added; with the prop it is one entry chunk again,
+133 B over `main`. The footer must not import `services.tsx`.

### D7. The local servers answer `/release.json` too

`vite dev` and `vite preview` serve `/release.json` from a middleware (`vite-plugins/release-preview.ts`): the
checked-out commit and `release: null`, uncached, the development site's shape. So a developer and the E2E suite
see `Version dev <commit>`, and no page logs a 404 for the fetch: Chromium reports a 404 response as a console
error, and several E2E specs fail on any console error (found on the first CI run of this change). It is server
middleware only; the built files never contain the file (`gen-context.mjs` refuses one), and a deploy publishes the
real one next to the site.

### D6. Tests

- `release-manifest.test.ts`: `--release v1.2.3` lands in both files after `commit`; without it the field is `null`;
  a malformed value throws.
- `deploy-sh.test.ts`: production refuses without a tag at `HEAD`, names the tag with one, takes `GITHUB_REF_NAME`
  when `GITHUB_REF_TYPE=tag`, refuses two tags; development never passes `--release`. The fixture repository gains a
  tag so the existing production-path tests keep their meaning, and the hermetic environment also strips `GITHUB_*`.
- `deploy-scripts.test.mjs`: the stub site's `release.json` carries `release`; production passes with a tag name,
  fails on `null`, on a malformed name and on an `EXPECT_RELEASE` mismatch, and derives the expectation from
  `GITHUB_REF_*`; development passes only with `null`.
- `test/lib/release.test.ts`, `test/landing/release.test.ts`, `test/ui/release-tag.test.tsx`: validation, labels,
  the hidden-until-known behaviour, the 404 and timeout cases, and the app footer rendering through a fake service.
- `test/build/release-preview.test.ts`: the local servers' identity and middleware (D7); `e2e/specs/23-release-version.spec.ts`:
  both footers show `Version dev <commit>` under the real CSP with no console error.

## Threat / abuse

No crypto, contract or paymaster path changes. Two points were considered:

- **A tag name reaching the DOM.** The name is validated against the tag grammar (letters, digits, `.`, `-`) before
  it is used, and set through `textContent` and `href`, so a crafted tag cannot inject markup or a foreign URL; the
  link target is a fixed GitHub path with the validated name appended. Only an admin can create a tag.
- **The footer as a trust signal.** The line says which release a visitor is on; it is not an integrity control.
  Integrity stays with `/release.json`'s commit and tree hash and the published rebuild procedure, which this change
  leaves untouched. A spoofed site could print any version, exactly as it could print anything else.

Security review: the change touches `.github/scripts/deploy/smoke.sh` (CI); the review is this section plus the
smoke-test tests. Recorded 2026-10-20, with the bundle measurement above.

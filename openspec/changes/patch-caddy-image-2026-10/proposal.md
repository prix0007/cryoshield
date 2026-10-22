# Proposal

## Why

Two advisories published on 2026-10-20/21 turned the `pr-checks` Trivy gate red for every pull request and for the
next scheduled development deploy (first seen on PR #127, run 39763035052, after the 09:30 UTC dev deploy had passed):

- **CVE-2026-107891** (musl 1.2.5-r23, unscored, fixed in r24) in the `caddy:2.11.7-alpine` base image we pin by
  digest. Docker Hub rebuilt the tag on 2026-10-21 with alpine 3.23.6 and musl 1.2.5-r24; the rebuild carries the fix.
- **CVE-2026-111943** (Go standard library 1.26.8 `crypto/x509`, HIGH per Trivy, 6.8 per Red Hat, fixed in Go
  1.26.10 and 1.27.3) in the Caddy binary. Go added a denylist that makes `Verify` fail for intermediates of a
  certificate authority no longer trusted. The rebuilt image is still compiled with Go 1.26.8, and no Caddy image with
  Go 1.26.10 exists yet, so this one needs a reviewed exception like the eight Caddy entries already accepted.

## What Changes

- `apps/web/deploy/Dockerfile`: the `FROM caddy:2.11.7-alpine@sha256:…` index digest moves from the 2026-10 build
  (`d8542f48…`) to the 2026-10-21 rebuild (`24ec7b05…`). Same tag, same Caddy 2.11.7, same Go 1.26.8.
- `.github/trivyignore.yaml`: one new entry, `CVE-2026-111943`, path `usr/bin/caddy`, with a statement and the same
  2026-12-31 expiry as the other Caddy entries.
- `README.md` → "Known vulnerabilities": a row for `CVE-2026-111943`; the paragraph above the table says the image now
  waits for Go 1.26.10 and that the digest follows the tag's rebuilds.

## Out of scope

- Moving to another Caddy version or image (2.11.7 is the current release; no image with Go 1.26.10 exists).
- The other eight Caddy exceptions (unchanged; they still wait for Go 1.26.9 or later).
- The `braces` exception (OpenSpec change `patch-vitest-openspec-cli-and-beacon`, issue #128).

## Runtime dependencies

No new dependency and no CryoShield-operated backend. The static site keeps being served by the same Caddy 2.11.7 on
Fly; only the base image's build changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. `ci-pipeline` ("Container image and filesystem vulnerability scan") already requires a digest-pinned base
image, a native-format ignore file with statement and expiry, and a README mirror; this change applies that
requirement to two new findings. `.openspec.yaml` sets `skip_specs: true`.

## Impact

- **Changed:** `apps/web/deploy/Dockerfile`, `.github/trivyignore.yaml`, `README.md`.
- **CI:** `pr-checks` (Trivy over the lockfiles, the new base image and the Dockerfile) and `web` (the deploy tests build
  the image) run. The development deploy's full CI on the merge commit is the second verification.
- **Users:** none visible. The served bytes are the same `dist/`; only the musl library in the container changes.

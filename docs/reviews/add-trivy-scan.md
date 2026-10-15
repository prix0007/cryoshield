# Security review: Trivy scan in the PR gates and the Caddy 2.11.7 bump (add-trivy-scan)

**Subject:** OpenSpec change `add-trivy-scan`: Trivy 0.76.0 in `pr-checks` (`.github/workflows/ci.yml`), the gate
`.github/scripts/trivy-gate.mjs`, the exception file `.github/trivyignore.yaml`, the README "Known vulnerabilities"
record, and `apps/web/deploy/Dockerfile` moving from `caddy:2.11.4-alpine` to `caddy:2.11.7-alpine`.
**Date:** 2026-10-16 · **Reviewer:** agent (read-only pass over the diff, local runs of every gate) · **External audit:** none.

**Verdict: APPROVE.** No CRITICAL or HIGH finding in the change itself. The change *records* 9 accepted HIGH/unknown
findings in the Caddy binary's Go toolchain (table below), all denial-of-service or unreachable code on this
deployment, each expiring 2026-12-31.

## Scope and method

Read-only review of the diff. Locally: the gate's unit tests (`npm test --prefix .github/scripts`, 440 passing),
`workflow-policy.mjs` (OK), `actionlint` (clean), `zizmor 1.30.1 --persona=pedantic` (no findings),
`openspec validate --all --strict` (47 passing), the pinned Linux tarball's SHA-256 (matches the release's
`trivy_0.76.0_checksums.txt`; it unpacks a top-level `trivy`), and the step's exact commands against the checkout
with the pinned Trivy version: the gate passes with the ignore file and fails without it, fails when an id is removed
from the README, and the step refuses a `FROM` without a digest before pulling anything.

## What was verified OK

- **Token and secrets.** The steps sit in `pr-checks`: `pull_request` trigger, `permissions: contents: read`,
  `persist-credentials: false`, no `secrets` context, no `${{ }}` in `run:`. Inputs reach the script through `env:`
  (`DOCKERFILE`, `IGNORE_FILE`), both fixed strings.
- **Supply chain.** Trivy is downloaded from the GitHub release, checked with `sha256sum -c` against a sum copied from
  the release's checksums file, and run from `RUNNER_TEMP`. No third-party action is added. The base image is pulled by
  digest only (the step fails on a tag-only `FROM`), so the scanned image is the deployed base.
- **Fail closed.** Trivy runs with `--exit-code 0`; any non-zero exit is a scanner error and fails the step under
  `set -e` (the default shell for `run:` is `bash -e`). The gate blocks on `CRITICAL`, `HIGH` and `UNKNOWN` (and on a
  missing severity), on `FAIL` misconfigurations at `CRITICAL`/`HIGH`, on any lint error in the ignore file, and on an
  excepted id missing from the README.
- **Ignore file.** Parsed with the `yaml` package (a real parser, not line-based), restricted to `vulnerabilities` and
  `misconfigurations` lists with `id`, `statement`, `expired_at` (≤ 90 days) and optional `paths`; anchors, aliases,
  explicit tags, second documents and unknown keys fail. Trivy reads the same file, so the lint and the scanner agree
  on the entries. Expired entries are dropped by Trivy and count again.
- **Dockerfile.** Only the tag and digest changed. Still `USER 65534:65534`, admin API and auto-HTTPS off, copies only
  `deploy/.build`. `trivy config` reports one LOW (DS-0026, no `HEALTHCHECK`); Fly runs the HTTP check on `/healthz`.
- **Docs.** `docs/maintainers.md`, `apps/web/deploy/README.md` and the README section describe the gate as built.

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| L1 | LOW | The vulnerability database and checks bundle are fetched from OCI mirrors without a checksum we control; a tampered database could hide or invent findings. Same trust as osv.dev today, and osv-scanner remains a second opinion for the lockfiles. | Accepted (design D4, threat section) |
| L2 | LOW | A new database entry can fail an unrelated PR at HIGH or `UNKNOWN`. Intended; the exception path is a reviewed, expiring entry plus a README line. | Accepted |
| L3 | LOW | `pr-checks` runs from the PR's commit, so a PR can edit the gate or the ignore file. Same limit as every PR gate: the paths are OpenSpec code paths, `workflow-lint` and the ECC review from `main` cover them, and the owner reads the diff. | Accepted |
| I1 | INFO | Trivy's `--db-repository` default order is `mirror.gcr.io` then `ghcr.io`; a rate limit on both fails the step rather than passing. | No change |

## Accepted vulnerabilities recorded by this change (expire 2026-12-31)

All in the Go toolchain compiled into `/usr/bin/caddy` of `caddy:2.11.7-alpine` (Go 1.26.8, `x/net` 0.59.0), fixed
upstream on 2026-10-08 (Go 1.26.9, `x/net` 0.60.0) and waiting for a Caddy image built with them. Fly terminates TLS
and sends plain HTTP/1.1 to Caddy, which serves static files only.

| Id | Severity | Why accepted |
|---|---|---|
| CVE-2026-78667 | HIGH | `net/http` Range DoS; static site, Fly restarts a crashed machine |
| CVE-2026-78669 | HIGH | HTTP/2 SETTINGS flood; HTTP/2 not exposed behind Fly |
| CVE-2026-97031 | HIGH | `crypto/tls` ECH; Caddy's TLS server is off |
| CVE-2026-78659, CVE-2026-78660 | unknown | HTTP trailer / framing; DoS at most |
| CVE-2026-94440 | unknown | `mime/multipart`; no request bodies parsed |
| CVE-2026-97030 | unknown | `html/template`; templates directive not enabled |
| GO-2026-5932 | unknown, no fix | `x/crypto/openpgp` unmaintained; not reachable from a request |
| CVE-2026-93687 | HIGH, no fix | `braces` in the CI-only OpenSpec CLI; mirrors the osv-scanner exception |

The bump from 2.11.4 removed 30 findings (18 HIGH) that no gate had seen. Dependabot's weekly `docker` update will
move the digest; the entries are removed when the image carries Go 1.26.9 or later.

## Residual risk

The web server keeps HIGH-rated denial-of-service exposure until Caddy publishes an image with Go 1.26.9. The impact
is availability of a static site that Fly restarts; no vault data, key material or user data is involved (there is
no backend and the site holds no secrets).

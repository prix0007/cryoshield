# Design

## Context

See `proposal.md` → Why. `add-trivy-scan` (D3/D4/D6) set the rules this change follows: the base image is pinned by
multi-arch index digest; the gate fails on CRITICAL, HIGH and unknown severities; exceptions live in
`.github/trivyignore.yaml`, each with an `id`, a `statement` and an `expired_at` at most 90 days ahead, and every id
must appear in the README's "Known vulnerabilities" table (`trivy-gate.mjs` checks the mirror). Changing the ignore
file needs a security review, recorded here.

Local scan of the rebuilt image (`trivy image --platform linux/amd64`, 2026-10-22, DB of the day):

| Finding | Package | Severity | Status in the rebuild |
|---|---|---|---|
| CVE-2026-107891 | musl, musl-utils 1.2.5-r23 | UNKNOWN | gone: `apk list --installed` in the rebuild shows musl and musl-utils 1.2.5-r24, the fixed version CI's Trivy named (the local Trivy database of 2026-10-22 did not yet carry this id, so the version is the evidence) |
| CVE-2026-111943 | Go stdlib 1.26.8 `crypto/x509` | HIGH | present (fix 1.26.10) |
| CVE-2026-78667, -78669, -97031 | Go stdlib 1.26.8 | HIGH | present, already excepted |
| CVE-2026-78669 | golang.org/x/net 0.59.0 | HIGH | present, already excepted |
| GO-2026-5932 | golang.org/x/crypto 0.57.0 | UNKNOWN | present, already excepted |
| 14 findings | stdlib, x/net | MEDIUM / LOW | reported, not blocking (standalone image scan without the ignore file; the same ids appear once per package, and four of them are already excepted). With the ignore file, the gate lists 6: 5 MEDIUM and 1 LOW in stdlib |

`caddy version` in the rebuilt image prints `v2.11.7 h1:yj0Y4fYZGPkSvibBJ1sTWE33xC0fxztVyXEW5iIdUT4=`.

## Goals / Non-Goals

**Goals:** `pr-checks` green again with the smallest change; the musl fix taken rather than excepted; the Go finding
excepted with a statement a reviewer can check against the Caddyfile; the README mirror kept.

**Non-Goals:** changing Caddy's configuration, the Fly setup or the TLS model; renewing or re-dating the existing
exceptions.

## Decisions

### D1. Take the rebuilt digest for musl instead of a second exception

Docker Hub's `2.11.7-alpine` tag was rebuilt on 2026-10-21 (index digest `24ec7b05…`, amd64 image
`04913b1d…`). The rebuild differs only in the alpine packages (musl 1.2.5-r24). An exception would have been the
easier edit, but a fix that exists is taken, as the ignore file's own header says. Dependabot's weekly docker bump
would have proposed the same digest after its 7-day cooldown.

### D2. Except CVE-2026-111943 until a Caddy image carries Go 1.26.10

The advisory is a hardening of certificate verification: Go's `crypto/x509` now refuses to build a chain through
intermediates of a specific distrusted certificate authority. It matters to programs that verify peer certificates.
This Caddy verifies none:

- inbound TLS is terminated by Fly, which talks plain HTTP/1.1 to Caddy (`apps/web/fly.toml`, `fly.dev.toml`);
- the Caddyfile serves static files only, with auto-HTTPS off, so there is no ACME client and no outbound TLS;
- there is no `reverse_proxy`, no `forward_auth`, no outbound request of any kind.

So `Verify` is never called, and the code path the fix changes is unreachable. Trivy rates it HIGH from its selected
severity source, which is why the gate blocks; Red Hat scores it 6.8 (AV:N/AC:H/PR:N/UI:R/C:H/I:H/A:N). The statement names the
unreachability argument and the awaited fix. Expiry 2026-12-31 matches the other Caddy entries, so they are all
re-examined together; it is 70 days ahead, within the 90-day cap.

Alternative rejected: building Caddy ourselves with Go 1.26.10 (`caddy:2.11.7-builder-alpine` plus `xcaddy`). It
would replace an upstream-built, digest-pinned binary with one we build in CI, a larger supply-chain surface than the
unreachable finding it removes.

## Threat / abuse

Supply chain only; no crypto, contract or paymaster path changes.

- **Wrong image:** the Dockerfile pins the multi-arch index digest, so the build fails rather than drifting; the
  digest was read from Docker Hub's tag listing and the amd64 image was pulled and scanned locally before the edit.
- **Overbroad exception:** the entry is scoped to `usr/bin/caddy`, one id, with an expiry; the README mirror makes it
  visible to every reader of the project.
- **Reachability changes later:** if a future change enables auto-HTTPS, ACME or `reverse_proxy` in the Caddyfile, the
  argument in D2 no longer holds and the exception must go. The expiry forces a re-read by 2026-12-31 at the latest.

## Security review (2026-10-22)

| # | Area | Check | Result |
|---|---|---|---|
| 1 | Base image | New digest is the current `2.11.7-alpine` index on Docker Hub; `caddy version` unchanged; Trivy finds no musl CVE in the rebuild | Pass |
| 2 | Exception | `CVE-2026-111943` scoped to `usr/bin/caddy`; statement checked against `fly.toml` (TLS at Fly) and the Caddyfile (static, no auto-HTTPS, no ACME, no `reverse_proxy`); expiry 2026-12-31 (70 days) | Pass |
| 3 | Gate | Local mirror of the CI step (fs, image, config scans with the ignore file, then `trivy-gate.mjs` with the README): "no CRITICAL/HIGH/unknown findings"; with the ignore file the gate reports 6 stdlib findings (5 MEDIUM, 1 LOW; 14 in the standalone scan above, see the Context table) and `DS-0026` (no HEALTHCHECK, LOW); mirror check passes; `npm test --prefix .github/scripts` 442/442 | Pass |
| 4 | Container | `pnpm --filter @cryoshield/web test:deploy`: 7 files / 128 tests pass, including the container tests that build and run the image from the new digest | Pass |

## Risks / Trade-offs

- [The rebuild changes more than musl] → the amd64 image was scanned and `caddy version` compared; the deploy tests
  run the container; the dev deploy's smoke test runs on the merge commit.
- [Nine Caddy exceptions now, all expiring 2026-12-31] → when they expire together, the only honest renewal is a
  Caddy image built with Go 1.26.10 or later; Dependabot's docker group proposes new digests weekly.

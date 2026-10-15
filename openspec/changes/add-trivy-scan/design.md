# Design: Trivy vulnerability scan in the PR gates

## Context

`pr-checks` (adopt-pr-workflow) runs gitleaks over the PR's commits and osv-scanner over the lockfiles. The web site is served by one Caddy container on Fly (add-fly-hosting), `FROM caddy:<tag>-alpine@sha256:…`. Nothing scans that image, its Alpine packages or the Go modules compiled into `/usr/bin/caddy`, nor the Dockerfile itself.

**Local baseline, Trivy 0.76.0, 2026-10-16** (database of that day):

| Target | Findings | Blocking (CRITICAL / HIGH / UNKNOWN) |
|---|---|---|
| lockfiles (`trivy fs`) | 1 | `braces@3.0.3` CVE-2026-93687 HIGH, no fix; already an osv-scanner exception (GHSA-vfj7-8cjw-p6xm, CI-only OpenSpec CLI) |
| `caddy:2.11.4-alpine` (pinned today) | 50 | 22 HIGH, 8 UNKNOWN: Go 1.26.3 stdlib, `x/net` 0.55, `x/crypto` 0.52, `x/text` 0.37, `grpc` 1.81 |
| `caddy:2.11.7-alpine` (newest, 2026-10-06) | 20 | 4 HIGH, 5 UNKNOWN: Go 1.26.8 stdlib and `x/net` 0.59.0, all fixed upstream in Go 1.26.9 / `x/net` 0.60.0 (2026-10-08), not yet in a Caddy image |
| `apps/web/deploy/Dockerfile` (`trivy config`) | 1 | none (DS-0026 no HEALTHCHECK, LOW) |

## Decisions

### D1. Where it runs: steps in `pr-checks`, after osv-scanner

Pull requests only, like the other scanners: a vulnerability-database update must fail a PR, never a deploy or a release (the deploy pipeline's full CI re-runs `ci.yml` with `full: true`, which skips `pr-checks`). The job already has the right shape: `contents: read`, no secrets, no API calls, `persist-credentials: false`. There is no path filter for the scan: the image's finding set changes without any file in the repository changing.

*Rejected:* a separate scheduled workflow. The policy for scheduled read-only workflows (add-privacy-preserving-analytics) allow-lists programs and actions per workflow, and a scheduled failure has nobody to fix it; a PR failure does.

### D2. Tool pinning: release binary, version and SHA-256 in `env`

Same pattern as `GITLEAKS_VERSION`/`GITLEAKS_SHA256`: `TRIVY_VERSION: "0.76.0"`, `TRIVY_SHA256` of `trivy_0.76.0_Linux-64bit.tar.gz` copied from the release's `trivy_0.76.0_checksums.txt`. No third-party action (`aquasecurity/trivy-action` would download its own binary and widen the pinned surface). The sum is checked with `sha256sum -c` before the archive is opened.

### D3. Scope: three scans, the base image rather than the built image

1. `trivy fs --scanners vuln` over the checkout, skipping `**/node_modules` and `**/.venv` (the installed gate-script tree would only repeat its lockfile). Trivy reads `pnpm-lock.yaml`, `tools/recover/uv.lock`, the two `package-lock.json` files and `packages/vault-crypto/scripts/requirements.txt`. This overlaps osv-scanner on purpose: two databases, and Trivy also covers `requirements.txt`, which osv-scanner is not given.
2. `trivy image` of the reference on the Dockerfile's first `FROM` line. The step refuses a reference without `@sha256:` (web-hosting: the image must be digest-pinned), so the scanned image is exactly the deployed base. The built image adds only `deploy/.build/site` and a Caddyfile to it, nothing with a package or binary, so scanning the base image gives the same vulnerability set without a web build in `pr-checks`.
3. `trivy config` over the Dockerfile (misconfiguration checks: root user, latest tags, secrets in `ENV`, and so on).

Each scan writes JSON under `RUNNER_TEMP` with `--exit-code 0`, so a non-zero exit means a scanner failure (network, database) and fails the step at once; findings are judged only by the gate.

### D4. The gate: `.github/scripts/trivy-gate.mjs`, same posture as `osv-gate.mjs`

- **Blocking:** vulnerabilities with severity `CRITICAL`, `HIGH` or `UNKNOWN` (fail closed, like osv-gate's "unscored"), and misconfigurations with status `FAIL` at `CRITICAL` or `HIGH`.
- **Advisory, printed, not failing:** `MEDIUM` and `LOW`.
- **Ignore file** `.github/trivyignore.yaml`, Trivy's native format, so Trivy itself applies it (`--ignorefile`) and the gate only lints it. Accepted shape, anything else fails closed:
  - top-level keys `vulnerabilities` and `misconfigurations` only (no `secrets`, no `licenses`, no package-wide rules);
  - each entry: `id` (`^[A-Za-z0-9][A-Za-z0-9_.:-]*$`), `statement` (non-empty string), `expired_at` (`YYYY-MM-DD`, at most 90 days ahead), optional `paths` (list of strings);
  - no anchors, aliases, explicit tags or multiple documents.

  The file is read with the `yaml` package already used by `workflow-policy.mjs`, a real YAML parser, so the lint and Trivy's parser see the same entries (the osv-gate HIGH-1 lesson about line-based readers). Trivy drops an expired entry itself, so an expired exception counts again without any gate logic.
- **README check:** every `id` in the ignore file must appear in `README.md`. The founder's ask was to post the CVEs in the README; tying the gate to it keeps the public record and the ignore file in step in both directions (an exception cannot be added quietly, and a removed exception leaves a stale README line that the next edit cleans).

### D5. README "Known vulnerabilities" section

Under "Security": which scanners run on every PR (gitleaks, osv-scanner, Trivy), the threshold, where the exceptions live, and a table of the accepted exceptions (id, where, severity, why it is accepted, until when). Wording stays factual and short; the table is the record the gate checks.

### D6. Caddy 2.11.4 → 2.11.7

`caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f` (multi-arch index digest from Docker Hub, 2026-10-06). It drops 30 findings, 18 of them HIGH. The 9 blocking findings that remain are all in the Go toolchain of the Caddy binary, fixed upstream on 2026-10-08 and waiting for a Caddy image built with Go 1.26.9 and `x/net` 0.60.0. They are accepted until 2026-12-31 with these reasons:

| Id | Where | Why it is accepted on this deployment |
|---|---|---|
| CVE-2026-78667 (HIGH) | `net/http` Range headers DoS | Caddy serves a static site behind Fly's proxy; a crash restarts the machine, no data is at risk |
| CVE-2026-78669 (HIGH), CVE-2026-78659, CVE-2026-78660 (UNKNOWN) | HTTP/2 SETTINGS flood, trailers, malformed framing | Same: denial of service only; Fly terminates TLS and talks plain HTTP/1.1 to port 8080 |
| CVE-2026-97031 (HIGH) | `crypto/tls` ECH outer extensions DoS | TLS is terminated by Fly; Caddy's TLS server is not reachable (auto-HTTPS off) |
| CVE-2026-94440 (UNKNOWN) | `mime/multipart` memory limit bypass | `file_server` parses no forms |
| CVE-2026-97030 (UNKNOWN) | `html/template` | the `templates` directive is not enabled |
| GO-2026-5932 (UNKNOWN, no fix) | `x/crypto/openpgp` unmaintained | compiled in through a Caddy dependency, not reachable from a request |

Dependabot's weekly `docker` update bumps the digest; when it moves to an image built with Go 1.26.9 or later, the expired entries are removed from the ignore file and the README.

## Threat and abuse analysis

- **Weakening the gate from a PR.** `.github/trivyignore.yaml`, the gate script and `ci.yml` are code paths for the OpenSpec gate and under `workflow-lint` and the ECC review; an exception needs a statement and expires within 90 days; the README must list it. `pr-checks` runs from the PR's own commit (`pull_request`, not `pull_request_target`), so a PR can edit the gate, which is the same accepted limit as for the other PR gates: `ecc-review` runs from `main` and the owner reads the diff.
- **What the step can reach.** Read-only token, no secrets, egress only to `github.com` releases (checksummed download), the Trivy database mirrors (`mirror.gcr.io`, `ghcr.io`), the checks bundle and Docker Hub (a digest-pinned pull, content-addressed). Trivy writes only under `RUNNER_TEMP`.
- **Database trust.** The vulnerability database is not checksummed by us; a tampered database could hide or invent findings. That is the same trust placed in osv.dev today, and a hidden finding here still has osv-scanner as a second opinion for the lockfiles.
- **Image pull by digest.** The reference is taken from the Dockerfile and must carry `@sha256:`; a tag-only reference fails the step, so the scanned image cannot differ from the deployed base.
- **Noise.** Failing closed on `UNKNOWN` severity can block an unrelated PR when the database gains an entry before a score. Accepted: it mirrors osv-gate, the fix is quick and public, and the alternative (ignoring unscored findings) is how the 2.11.4 image reached 22 HIGH unnoticed.
- **The Caddy bump.** Only the tag and digest change; the Dockerfile still copies only `deploy/.build`, runs as 65534 and keeps the admin API off. The production run's "Release review" lists the Docker context as a token path, so the owner sees it before a release.

## Security review

Record: `docs/reviews/add-trivy-scan.md` (task 6.1).

# Proposal

## Why

The founder asked for "a trivy vulnerability check pipeline" and to "post in README about CVEs if any". Today the PR gates cover secrets (gitleaks) and the lockfiles (osv-scanner), but nothing scans what actually serves https://cryoshield.app: the Caddy container image (Alpine packages and the Go binary) and its Dockerfile. A local Trivy 0.76.0 run on 2026-10-16 found 22 HIGH findings in the pinned `caddy:2.11.4-alpine` image (all in the Go toolchain compiled into the Caddy binary) that no existing check could see, and no public place records which known vulnerabilities the project has accepted.

## What Changes

- **Trivy in `pr-checks`** (`.github/workflows/ci.yml`), pinned by version and SHA-256 like gitleaks and osv-scanner. Three scans on every pull request:
  - `trivy fs` over the checkout (every committed lockfile: pnpm, uv, npm, pip);
  - `trivy image` of the base image named by the web Dockerfile's `FROM` line, which must be digest-pinned;
  - `trivy config` over the Dockerfile.
- **A gate script** `.github/scripts/trivy-gate.mjs` (tests first) that fails on any CRITICAL, HIGH or unknown-severity vulnerability and on any CRITICAL or HIGH misconfiguration, reports the rest, and lints the ignore file.
- **A reviewed, expiring ignore file** `.github/trivyignore.yaml` (Trivy's native format; each entry needs an id, a statement and an `expired_at` at most 90 days ahead).
- **README "Known vulnerabilities"**: the scanners that run, the gate's threshold, and a table of every accepted exception. The gate fails when an excepted id is missing from the README, so the public record cannot drift from the ignore file.
- **Caddy base image 2.11.4 → 2.11.7** (`apps/web/deploy/Dockerfile`, digest-pinned). This removes 30 of the 49 image findings, 18 of them HIGH. The 4 HIGH and 5 unknown-severity findings that remain are in Go 1.26.8 and `golang.org/x/net` 0.59.0, fixed upstream on 2026-10-08 but not yet in any Caddy image; they are accepted until 2026-12-31 with per-finding reasons.
- `docs/maintainers.md` and `apps/web/deploy/README.md` updated.
- **Runtime dependencies: none.** Trivy runs only on GitHub-hosted runners in the PR job, with a read-only token and no secrets. It is not a CryoShield-operated backend. The Caddy bump changes only the pinned image digest; the image still contains only the verified static build.

**Out of scope:**
- scanning the built deploy image (it adds only static files and a Caddyfile to the base image; building it in `pr-checks` would need a full web build);
- Trivy's secret and licence scanners (gitleaks and `scripts/check-licenses.sh` already cover them);
- running Trivy on push to `main` or in the deploy pipeline's full CI (a database update must never block a release, the same choice as osv-scanner);
- SBOM generation and GitHub code-scanning upload (not available on this plan);
- a `HEALTHCHECK` in the Dockerfile (Trivy DS-0026, LOW; Fly runs its own HTTP check on `/healthz`).

## Capabilities

### Modified Capabilities
- `ci-pipeline`: adds the container-image, Dockerfile and filesystem vulnerability scan to the pull-request gates, with its exception policy and the README record.

## Impact

- New files: `.github/scripts/trivy-gate.mjs`, `.github/scripts/test/trivy-gate.test.mjs`, `.github/trivyignore.yaml`, `docs/reviews/add-trivy-scan.md`.
- Edited files: `.github/workflows/ci.yml`, `apps/web/deploy/Dockerfile`, `apps/web/deploy/README.md`, `README.md`, `docs/maintainers.md`.
- `pr-checks` takes about one to two minutes longer (vulnerability database download, one image pull by digest).
- A new entry in the Trivy database can fail an unrelated PR at HIGH or above. That is the intended behaviour; the fix is a dependency or image bump, or a reviewed, expiring exception that the README must list.
- Security review: CI and the Docker context change, so this change ends with a review record.

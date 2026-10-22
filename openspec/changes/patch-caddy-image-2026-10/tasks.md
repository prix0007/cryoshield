# Tasks

## 1. Failing check first

- [x] 1.1 Reproduce the CI failure locally: `trivy image --platform linux/amd64 --severity CRITICAL,HIGH,UNKNOWN
  --ignorefile .github/trivyignore.yaml caddy:2.11.7-alpine@sha256:d8542f48…` on `main`. Verify it reports
  CVE-2026-107891 (musl) and CVE-2026-111943 (stdlib) and nothing else above the threshold.

  2026-10-22: CI run 39763035052 (Trivy 0.76.0) reported exactly those two. Locally the old digest reports
  CVE-2026-111943 (HIGH) plus the already-excepted entries; the local database did not carry CVE-2026-107891, so the
  musl side is verified by package version in 2.1.

## 2. Fix and records

- [x] 2.1 `apps/web/deploy/Dockerfile`: `FROM` digest → `sha256:24ec7b05bc532c7bb57f727030c5056e257ff7138b4b50460306819ff79362bd`
  (D1). Verify `docker run --rm --platform linux/amd64 <image> caddy version` prints v2.11.7 and Trivy no longer lists
  a musl finding.

  2026-10-22: `caddy version` → v2.11.7; `apk list --installed` → musl 1.2.5-r24, musl-utils 1.2.5-r24; Trivy: no musl
  finding, CVE-2026-111943 the only HIGH not already excepted.
- [x] 2.2 `.github/trivyignore.yaml`: entry for `CVE-2026-111943` (D2); `README.md`: matching row and the updated
  paragraph. Verify `grep -c CVE-2026-111943 .github/trivyignore.yaml README.md` is 1 and 1.

  2026-10-22: 1 and 1.
- [x] 2.3 Mirror the CI step: `trivy fs` over the lockfiles, `trivy image` over the new digest, `trivy config` over the
  Dockerfile, all with `--ignorefile`, then `node .github/scripts/trivy-gate.mjs --ignore … --readme README.md
  <reports>`. Verify the gate exits 0 and `npm test --prefix .github/scripts` passes (ignore-file lint).

  2026-10-22: "trivy gate: no CRITICAL/HIGH/unknown findings" (6 MEDIUM/LOW and DS-0026 reported); 442/442.
- [x] 2.4 `pnpm --filter @cryoshield/web test:deploy` (Docker). Verify the container tests pass on the new digest.

  2026-10-22: 7 files / 128 tests passed.

## 3. Review

- [x] 3.1 Security review recorded in `design.md` (rows 1–4 filled with the results of 1.1, 2.1, 2.3, 2.4). Verify no row
  is open.

  2026-10-22: rows 1–4 Pass.

# Tasks

## 1. Gate script (tests first)

- [x] 1.1 `.github/scripts/test/trivy-gate.test.mjs`: report evaluation (HIGH, CRITICAL and UNKNOWN block and name target, package, version, advisory and fix; MEDIUM/LOW advisory; misconfiguration FAIL at HIGH blocks, LOW advisory, PASS ignored; empty report passes), ignore-file lint (valid file returns its ids; missing statement, missing or far expiry, unknown top-level or entry key, anchor/alias/tag, second document, non-list fail and name the line), README check (present passes, missing names the id), and the CLI end to end (clean passes, HIGH exits 1, README gap exits 1, bad usage exits 2). Run `npm test --prefix .github/scripts`: the new file fails because the script does not exist.
- [x] 1.2 Implement `.github/scripts/trivy-gate.mjs` (D4). Verify with `npm test --prefix .github/scripts` (all green).

## 2. Ignore file and README record

- [x] 2.1 `.github/trivyignore.yaml` (D6): the braces entry mirrored from `.github/osv-scanner.toml` and the nine Caddy 2.11.7 toolchain findings, each with a statement and `expired_at: 2026-12-31`. Verify: `trivy image --ignorefile .github/trivyignore.yaml` on the 2.11.7 digest followed by the gate passes; without the ignore file the gate fails.
- [x] 2.2 README "Known vulnerabilities" (D5) listing the scanners, the threshold and every excepted id. Verify: the gate's README check passes; removing one id from the README fails it.

## 3. CI

- [x] 3.1 `ci.yml`: `TRIVY_VERSION`/`TRIVY_SHA256` env and an install step after osv-scanner (D2), the three scans and the gate (D3), with the digest guard on the `FROM` reference. Verify locally: `node .github/scripts/workflow-policy.mjs .github`, `actionlint`, `uvx zizmor==1.30.1 --offline --persona=pedantic --config .github/zizmor.yml .github`, `npm test --prefix .github/scripts`.
- [x] 3.2 Run the step's commands locally against the checkout with the pinned Trivy version and confirm the gate output matches the design baseline.

## 4. Caddy base image

- [x] 4.1 `apps/web/deploy/Dockerfile` → `caddy:2.11.7-alpine@sha256:d8542f…` (D6); update `apps/web/deploy/README.md`. Verify: `trivy image` of the new digest reports 4 HIGH and 5 UNKNOWN, all covered by 2.1.

## 5. Docs

- [x] 5.1 `docs/maintainers.md`: Trivy in the `pr-checks` list and the exceptions sentence. Verify by reading.
- [x] 5.2 `openspec validate --all --strict` green.

## 6. Security review

- [x] 6.1 Record `docs/reviews/add-trivy-scan.md`: scope (CI step, gate, ignore file, Docker context), what was verified, findings and residual risk (D4 noise, database trust, D6 accepted findings).

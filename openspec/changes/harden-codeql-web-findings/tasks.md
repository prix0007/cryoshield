# Tasks

## 1. CSP gate (CodeQL #8/#9)

- [x] 1.1 Regression tests (`test/build/csp-check.test.ts`):
  - exact set passes;
  - prefix spoof, subdomain, path and port spoofs fail;
  - extra `https:` or `*` fails;
  - a missing directive fails;
  - origin text outside the directive doesn't count.
- [x] 1.2 `scripts/csp-check.mjs` (`directives`, `connectSrcViolations`); verify-build uses it on the parsed app CSP meta tag; `analytics-check.mjs` reuses `directives()`.

## 2. Renderer markers (CodeQL #4)

- [x] 2.1 Regression tests (`test/legal/renderer-markers.test.ts`):
  - known markers pass exactly;
  - smuggled `<script>` and `<img onerror>` lines fail;
  - near-miss markers fail;
  - the real documents still render.
- [x] 2.2 `LEGAL_MARKERS` exact allowlist in `vite-plugins/legal.ts`.

## 3. Verification

- [x] 3.1 Web unit, build, deploy, E2E and verify-build pass, and the CodeQL alerts are closed on the PR.

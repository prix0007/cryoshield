# Proposal

## Why

CodeQL triage found two weak checks in the web build:

- **#8 and #9 (`js/incomplete-url-substring-sanitization`, `apps/web/scripts/verify-build.mjs`).**
  - The production CSP gate checks that the configured origins appear *somewhere* in the built HTML.
  - A prefix-spoofed source such as `https://rpc.verify.invalid.evil.com` in `connect-src`, or the origin text
    anywhere else on the page, would pass.
  - Unexpected extra sources weren't rejected either.
- **#4 (`js/bad-tag-filter`, `apps/web/vite-plugins/legal.ts`).**
  - The legal Markdown renderer copies any line matching `^<!--.*-->$` into the page raw.
  - So `<!-- --><script>…</script><!-- -->` passes, breaking the renderer's promise that everything is escaped.

## What Changes

- **verify-build:** it parses the production app page's CSP meta tag into directives (a shared `directives()` in the
  new `scripts/csp-check.mjs`, now also used by `analytics-check.mjs`).
  - It requires `connect-src` to be **exactly** `'self'` + the configured origins + the app-only fast index, as a set
    of tokens.
  - A missing, spoofed or unexpected token fails the build.
- **Legal renderer:** comment-looking lines pass through only when they are **exactly** one of the known markers
  (`<!--legal-note-->` and `<!--storage-inventory-->`, the only ones in use). Any other such line fails the build.
- **Tests:** regression tests for prefix- and suffix-spoofed origins, extra tokens, smuggled markup and near-miss
  markers.

## Capabilities

### New Capabilities
- `web-build-integrity`: exact-token CSP verification and the renderer's exact marker allowlist.

## Impact

- **Code:** `apps/web/scripts/{csp-check.mjs, analytics-check.mjs, verify-build.mjs}`, `apps/web/vite-plugins/legal.ts`.
- **Tests:** `test/build/csp-check.test.ts`, `test/legal/renderer-markers.test.ts`.
- **Nothing else changes:** no workflow, no runtime code, no change to the shipped pages.

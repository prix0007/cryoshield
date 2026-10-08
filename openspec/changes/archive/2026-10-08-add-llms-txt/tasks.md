# Tasks

## 1. Tests first

- [x] 1.1 `test/build/seo.test.ts`: `llmsTxt` output format (H1, summary blockquote, status, a link per public page with its description, source links, optional section), no `/app/`, the honesty denylist, `robots.txt` comment. Verify they fail first.
- [x] 1.2 `test/build/pages.test.ts` (real build): `llms.txt` is in the output and lists the seven canonical URLs.

## 2. Build

- [x] 2.1 `vite-plugins/seo.ts`: `llmsTxt()` and emission from the source page HTML in `generateBundle`.
- [x] 2.2 `public/robots.txt`: the `llms.txt` comment line.
- [x] 2.3 `scripts/verify-build.mjs`: `llms.txt` present, lists every public page, never `/app/`.

## 3. Verification

- [x] 3.1 E2E `e2e/specs/16-seo.spec.ts` and `deploy/test/container.test.ts`: `/llms.txt` served with 200 and `text/plain`.
- [x] 3.2 Web unit suite, typecheck, lint, build, `verify-build`, the deploy tests, `openspec validate --all --strict`.

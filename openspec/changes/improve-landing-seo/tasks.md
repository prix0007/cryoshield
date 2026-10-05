# Tasks

## 1. Tests first

- [x] 1.1 `test/build/csp.test.ts` + `test/build/csp-check.test.ts`: `injectCsp` and `stripJsonLd` accept only an attribute-exact `<script type="application/ld+json">` with a JSON body free of `<`, and still reject plain inline scripts, other types, extra attributes and malformed bodies. Verify they fail first.
- [x] 1.2 `test/build/seo.test.ts` (unit): the SEO plugin's head tags, the length limits failing the build, the FAQ extraction, the JSON-LD escaping, the sitemap, the noindex rules, and the share image (1200×630, recorded hash). Verify they fail first.
- [x] 1.3 `test/landing/content.test.ts`: the new H1, H2 order and FAQ questions; the "forever" exception and the unchanged denylist on text, title and description. Verify they fail first.
- [x] 1.4 `test/build/pages.test.ts` (real build, reused): every public page has title, description, canonical, OG and Twitter tags; the JSON-LD parses and the FAQ JSON-LD equals the visible FAQ; `robots.txt`, `sitemap.xml` and `og-image.png` are in the output; `/app/` is noindex. Update its hero text and ld+json exception, and the canonical exception in the legal, devices and architecture page tests.

## 2. Build

- [x] 2.1 `scripts/csp-check.mjs` `stripJsonLd` (+ `.d.mts`), used by `vite-plugins/csp.ts` and `scripts/verify-build.mjs`; verify-build also strips the canonical link before the other-origin check, and checks robots, sitemap and noindex.
- [x] 2.2 `vite-plugins/seo.ts` wired in `vite.config.ts` before the CSP plugin.
- [x] 2.3 Titles and descriptions in the seven public page shells; landing copy (H1, lead, final CTA, FAQ heading, FAQ entries); two more hero word delays in `landing.css`.
- [x] 2.4 `public/robots.txt`; `brand/og-image.svg`, `scripts/build-og-image.mjs`, `public/og-image.png`, `brand/og-image.sha256`, the `og-image` package script.

## 3. Verification

- [x] 3.1 E2E `e2e/specs/16-seo.spec.ts`: no CSP/Trusted Types violation on landing load, the JSON-LD parses, the FAQ disclosures open by keyboard, axe on the FAQ. Update `05-landing.spec.ts`, `90-screenshots.spec.ts` and `deploy/test/container.test.ts` (hero text; `robots.txt` and `sitemap.xml` served with the right types).
- [x] 3.2 Full web unit suite, typecheck, lint, `pnpm build`, `pnpm verify-build`, the deploy tests, and E2E where the local stack allows.

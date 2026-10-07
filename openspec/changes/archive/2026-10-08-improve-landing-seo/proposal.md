# Proposal

## Why

The founder: "improve SEO with backup, forever and such keywords." The public pages have short titles, two of them have
no meta description, there is no canonical URL, no share card, no structured data, no `robots.txt` and no
`sitemap.xml`. Search engines can't tell that cryoshield.app is about seed phrase backup, 2FA backup codes or
hardware-key encrypted backup, and links shared on social sites show no preview.

The words people search for ("backup seed phrase forever", "never lose your seed phrase") also pull against the
landing page's honesty rules. This change adds the keywords where they are true and answers the "forever" question
honestly, in a visible FAQ, instead of claiming it.

## What Changes

- **Head of every public page** (`/`, `/architecture`, `/devices`, `/support`, `/privacy`, `/terms`, `/cookies`):
  - a keyword-rich `<title>` of at most 60 characters and a meta description of 150–160 characters, written in each
    page's HTML;
  - injected at build time by a new `vite-plugins/seo.ts`: `<link rel="canonical">` to `https://cryoshield.app/...`,
    Open Graph tags and Twitter card tags, all derived from that title and description. The build fails if a public
    page lacks either or breaks the length limits.
- **Share image:** `public/og-image.png` (1200×630), rendered from the committed `brand/og-image.svg` (the brand icon
  and the landing hero type) by `scripts/build-og-image.mjs` with the Chromium already pinned by Playwright and the
  self-hosted Inter font. No runtime fetch.
- **Structured data on the landing page:** one JSON-LD `@graph` with `SoftwareApplication` (free, open source,
  `SecurityApplication`), `Organization` (the open-source project, `sameAs` the GitHub repository) and `FAQPage`. The
  `FAQPage` is generated at build time from the visible FAQ markup, so the two can't drift.
- **Visible copy:**
  - hero H1 "Seed phrase backups that outlive the drive."; a hero lead naming seed phrases and 2FA backup codes;
  - final call to action "Back up your seed phrase once."; FAQ heading "Backup questions, answered.";
  - new FAQ entries "How do I back up my seed phrase forever?" (answered: no backup lasts forever; what CryoShield's
    permanence depends on) and "Where should I store 2FA backup codes?"; "What happens if I lose my YubiKey?" and
    "What if CryoShield disappears?" replace the two older wordings.
- **Crawl files:** `public/robots.txt` (allow all, disallow `/app/`, `Sitemap:` line) and a build-generated
  `sitemap.xml` listing the public pages.
- **`/app/` stays `noindex`;** the build now enforces it.
- **CSP:** unchanged. The inline-script checks (`injectCsp`, `verify-build`, the pages test) gain one narrow
  exception: an attribute-exact `<script type="application/ld+json">` whose body is valid JSON with no `<`. Browsers
  never execute such a data block, so `script-src 'self'` and Trusted Types `'none'` are unaffected; an E2E test
  proves no CSP or Trusted Types violation on load.

**Out of scope:**
- the dev site's indexing (another change sets `X-Robots-Tag` on `dev.cryoshield.app`), `deploy.yml`, the Caddy
  config and the Fly files;
- search-console registration, backlinks, translations, a blog;
- any change to the vault app at `/app/` other than asserting its existing `noindex`.

**Runtime dependencies:** none. No new package; no CryoShield-operated backend. The share image and the sitemap are
static files served by the existing static host.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `landing-page`: search metadata on public pages, structured data, crawl files, the share image, the visible FAQ,
  updated hero and call-to-action copy, a narrow "forever" exception to the honesty rules, and JSON-LD under the
  strict CSP.

## Impact

- **New:** `vite-plugins/seo.ts`, `brand/og-image.svg`, `scripts/build-og-image.mjs`, `public/og-image.png`,
  `brand/og-image.sha256`, `public/robots.txt`, `test/build/seo.test.ts`, `e2e/specs/16-seo.spec.ts`.
- **Changed:** `index.html` and the six other public page shells, `vite.config.ts`, `vite-plugins/csp.ts`,
  `scripts/csp-check.mjs` (+ `.d.mts`), `scripts/verify-build.mjs`, `src/landing/landing.css` (two more hero word
  delays); tests: `test/build/{pages,csp,csp-check,architecture}.test.ts` (the built-page SEO checks live in
  `pages.test.ts`, reusing its build), `test/landing/content.test.ts`, `test/legal/{pages,devices}.test.ts` (the
  canonical link is the one absolute `href` allowed), `deploy/test/container.test.ts`,
  `e2e/specs/{05-landing,14-devices,90-screenshots}.spec.ts`; `package.json` (an `og-image` script).
- **Bundle:** no JavaScript change. The landing HTML grows by the head tags and about 3 KB of JSON-LD.

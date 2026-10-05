# Design

## Context

Every page is a static HTML shell built by Vite. `vite-plugins/cryoshield.ts` injects the strict CSP meta tag
(`injectCsp`), which refuses any inline `<script>`; `scripts/verify-build.mjs` re-checks every built page for inline
scripts and for any `src`/`href` pointing at another origin. `deploy/gen-context.mjs` serves `dist/` with Caddy's
`file_server`, so any file in `dist/` (a `robots.txt`, a `sitemap.xml`, a PNG) is served with the security headers and
needs no host change.

## Decisions

- **D1. Title and description live in each page's HTML; everything else is derived.** Editors change copy where they
  see it. `vite-plugins/seo.ts` reads `<title>` and `<meta name="description">` from each public page and injects the
  canonical link, the Open Graph tags and the Twitter card tags. One table, `PUBLIC_PAGES`, lists the public pages and
  their canonical paths; it also generates `sitemap.xml`. The build fails if a public page has no title or
  description, a title over 60 characters, or a description outside 150–160 characters (lengths counted on the
  decoded text).
- **D2. Canonical origin is a constant, `https://cryoshield.app`.** Not the build's RP ID: a build served on another
  host (the dev site) must still point search engines at production. Canonical paths match the site's own links:
  `/`, `/architecture`, `/devices`, `/support`, `/privacy`, `/terms`, `/cookies` (no trailing slash; Caddy serves
  both forms).
- **D3. `/support` counts as a public page.** The brief lists `/`, `/architecture`, `/devices` and the legal pages;
  `/support` is a public static page with the same chrome, so it gets the same tags and a sitemap entry. *Assumption,
  recorded here; drop it from `PUBLIC_PAGES` if the overwatcher disagrees.*
- **D4. JSON-LD as one `@graph` block on the landing page only.** `SoftwareApplication` (free `Offer`,
  `isAccessibleForFree`, MIT `license`, `applicationCategory: SecurityApplication`, `operatingSystem` "Any (web
  browser)"), `Organization` (described as an open-source project, `sameAs` the GitHub repository, logo
  `icon-512.png`) and `FAQPage`. The other pages carry no script element at all (the container tests already assert
  this for the legal pages).
- **D5. The FAQ JSON-LD is generated from the visible FAQ.** The plugin parses each `<details>` of `#faq` (question =
  `<summary>` text, answer = the `<p>` text with tags stripped and entities decoded). A unit test parses the built
  page with a DOM parser and asserts the JSON-LD questions and answers equal the visible text, in order. Google
  requires the marked-up FAQ to be visible on the page; generating it removes the drift risk.
- **D6. JSON-LD under the strict CSP.** A `<script>` whose type is not a JavaScript MIME type is a *data block*: the
  HTML standard says the browser never executes it, so `script-src` does not apply. Trusted Types
  (`require-trusted-types-for 'script'`) guard DOM injection sinks, not parser-inserted markup. So the CSP is
  unchanged. The repo's own guards forbid every inline `<script>`; they gain one exception (`stripJsonLd` in
  `scripts/csp-check.mjs`, shared by `injectCsp`, `verify-build` and the tests):
  - the opening tag must be exactly `<script type="application/ld+json">` (no other attribute, so no `src`, no
    handlers, no `nonce`);
  - the body must parse as JSON and contain no `<` (the plugin escapes `<` as `<`, so `</script>` can't appear);
  - anything else, including `type="application/json"`, `type="text/javascript"` or a malformed body, is still an
    inline-script failure.

  An E2E test loads the built landing page and asserts no `securitypolicyviolation` event and no CSP/Trusted Types
  console error, and that the block parses.
- **D7. Canonical link vs. the other-origin check.** `verify-build` rejects any `src`/`href` to another origin.
  `<link rel="canonical" href="https://cryoshield.app/...">` is not a fetched resource; the check strips exactly that
  form (the canonical origin, `rel` first) before scanning. Open Graph URLs are in `content` attributes, which the
  check never matched.
- **D8. Share image from the brand, rendered offline.** `brand/og-image.svg` (1200×630, white canvas, the Action Blue
  brand tile, the hero headline in Ink with the accent word in Action Blue, a muted lead and a "Testnet preview" chip)
  follows `docs/design/visual-language.md`: one accent, no gradients, no shadows. `scripts/build-og-image.mjs`
  renders it with Playwright's pinned Chromium, embedding the self-hosted Inter (`src/ui/fonts/…woff2`) as a `data:`
  URL so no system font or network is used, and writes `public/og-image.png` plus `brand/og-image.sha256`. A test
  checks the PNG is 1200×630 and matches the recorded hash. Run it with `pnpm --filter @cryoshield/web og-image`.
- **D9. robots.txt is static; sitemap.xml is generated.** `public/robots.txt`: `User-agent: *`, `Allow: /`,
  `Disallow: /app/`, `Sitemap: https://cryoshield.app/sitemap.xml`. Nothing blocks the whole site (the dev site is
  handled by a response header in another change). `sitemap.xml` has no `<lastmod>`, so builds stay byte-reproducible.
- **D10. `/app/` noindex is enforced.** `app/index.html` already carries `<meta name="robots" content="noindex">`. The
  plugin fails the build if it is missing, and if any public page carries `noindex`.

## Honesty: "forever" and "never lose"

The landing-page spec bans "forever", "guaranteed", "unbreakable" and "never lose" in the copy. The founder asked for
"forever" as a keyword. **Resolution (assumption, flagged for the overwatcher):**
- "forever" may appear only as the user's own question, the FAQ summary "How do I back up my seed phrase forever?",
  and in the negation that opens its answer, "No backup lasts forever". The answer then names what CryoShield's
  permanence depends on (the chain or the Arweave copy, and one working key) and the testnet caveat.
- "never lose" stays banned everywhere, including titles, descriptions and JSON-LD: there is no honest affirmative
  form of it for a product whose vault is lost with the last key.
- "Permanent" is used in the landing title ("Permanent Backup for Seed Phrases & 2FA Codes"). The page already calls
  Arweave a "permanent archive", and the encrypted vault is published permanently (the privacy policy says it can't be
  deleted). The description and the visible copy keep the caveats.

The content test enforces exactly this: it removes the two allowed phrases and then applies the unchanged denylist to
the visible text, and applies the denylist to the head metadata and JSON-LD as well.

## Risks / Trade-offs

- **[A longer H1 at display size]** "Seed phrase backups that outlive the drive." is 7 words instead of 5. It wraps
  to three lines on phones; the reflow test at 320 px and axe still run. Two more `nth-child` animation delays are added.
- **[Spec merge order]** The `Story tiles` delta here is based on `landing-only-you-can-read`'s version (with the
  "Only you can read it." tile). If that change is archived after this one, its older hero text would override; archive
  it first.
- **[Share image fonts]** The PNG depends on the Chromium build; the hash is recorded only to detect accidental
  edits, not to require byte-identical regeneration on another machine.

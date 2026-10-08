# landing-page Specification

## Purpose
The public landing page at the site root explains what CryoShield does, how it works, and its limits, in plain and
honest language, and routes visitors to the vault app without weakening the site's security posture.

## Requirements

### Requirement: Landing at the root, app at /app/
The site SHALL serve the landing page at `/` and the vault app at `/app/`. A request for `/app` SHALL redirect to
`/app/`. The landing page MUST NOT load the vault app's code. Vault behaviour MUST NOT depend on the URL path: the
WebAuthn RP ID stays the registrable domain.

#### Scenario: Routes
- **WHEN** `/`, `/index.html`, `/app/` and `/app/index.html` are requested from the deployed container
- **THEN** each returns 200 with `Cache-Control: no-cache`; `/` is the landing page and `/app/` is the vault app

#### Scenario: Trailing slash
- **WHEN** `/app` is requested
- **THEN** the response is a redirect to `/app/` on the same host

#### Scenario: No SPA fallback
- **WHEN** `/app/does-not-exist` or `/landing` is requested
- **THEN** the response is 404 and carries every security header

#### Scenario: Path-independent vault
- **WHEN** the app is loaded at `/app/` on host `cryoshield.app`
- **THEN** the app's WebAuthn calls use RP ID `cryoshield.app`, exactly as before the move

### Requirement: Same security headers and CSP on every page
Every HTML page SHALL carry the same strict CSP meta tag: no `unsafe-inline`, no `unsafe-eval`, Trusted Types `'none'`
and `script-src 'self'`. Every HTTP response SHALL carry the same security header set, with a CSP equal to that meta
CSP plus `frame-ancestors 'none'`. No page MUST load a script, style or font from another origin.

#### Scenario: Identical CSP
- **WHEN** the production build is verified
- **THEN** `index.html` and `app/index.html` contain byte-identical CSP meta tags, and the deploy context generator refuses to run if they differ

#### Scenario: Headers on both pages
- **WHEN** `/` and `/app/` are requested from the container
- **THEN** both carry every security header with the exact value and no `Server` header

#### Scenario: CSP enforced on the landing page
- **WHEN** an inline script or an `innerHTML` assignment is injected into the landing page
- **THEN** it does not run and the browser reports a CSP or Trusted Types violation

### Requirement: Honest landing content
The landing page SHALL state, in visible text that is not hidden behind interaction:
- that CryoShield runs on a testnet (OP Sepolia);
- that it has not been independently audited;
- that losing ALL enrolled keys means the vault cannot be opened by anyone.

It MUST NOT claim a capability the shipped code lacks, and MUST NOT use third-party trademarks as its own branding.

#### Scenario: Required disclosures present
- **WHEN** the landing page is rendered with motion disabled and with scripts disabled
- **THEN** the texts "OP Sepolia", "not been independently audited" (or equivalent) and the all-keys-lost warning are visible

#### Scenario: No overclaiming
- **WHEN** the landing copy is checked against a denylist of unsupported claims (e.g. "audited", "mainnet", "military-grade", "unhackable", "Ethereum L1 anchor")
- **THEN** none appears as an affirmative claim

### Requirement: Story tiles
The landing page SHALL present, in order:
- a hero ("Seed phrase backups that outlive the drive.");
- a band of key numbers;
- the story scenes and tiles:
  - fragile media ("Drives fail. Paper fades.");
  - the tap ("One tap. Sealed in your browser.");
  - storage ("Stored on-chain. Copied to Arweave.");
  - "Only you can read it." (a comparison with typical cloud storage);
  - "Lose a key, not your vault.";
  - "Survives us too.";
  - the permanence timeline ("Built for decades.");
- "Free to use.";
- a final call to action ("Back up your seed phrase once.");
- an FAQ ("Backup questions, answered.");
- a footer linking to the source code, the recovery tool documentation, and the license.

The hero, "Free to use." and the final call to action SHALL each offer one or two pill calls to action. A scene MAY
offer at most two.

#### Scenario: Tile order and CTAs
- **WHEN** the landing page is rendered
- **THEN** the sections' level-2 headings appear in the order above, the hero, "Free to use." and the final call to action each contain one or two pill links, and every pill leads to `/app/`, an in-page anchor, or the project's documentation

#### Scenario: Footer links
- **WHEN** the footer is rendered
- **THEN** it links to the GitHub repository, the recovery tool documentation, and the MIT license

### Requirement: Motion respects reduced motion
Animated graphics and scenes SHALL convey nothing that is not also stated in text. When the user prefers reduced motion:
- the page MUST NOT load any motion or scene code;
- scenes MUST NOT pin;
- every scene MUST show a static, informative key frame.

Motion MUST NOT move or hide text the user is reading, and no animation MUST flash more than three times per second.

#### Scenario: Reduced motion
- **WHEN** the page loads with `prefers-reduced-motion: reduce`
- **THEN** no motion or scene chunk is requested, no scene stage is sticky, every scene graphic shows its key frame, and all scene text is visible

#### Scenario: Motion lazy-loaded
- **WHEN** the page loads with motion allowed and only the hero is in view
- **THEN** no scene chunk is requested until a scene approaches the viewport, and each scene's code is requested only for that scene

### Requirement: Landing performance budget
The build verification MUST fail if:
- the landing page's initial JavaScript exceeds 15 KB gzip;
- any lazily loaded landing chunk exceeds 40 KB gzip;
- the landing page's whole JavaScript graph exceeds 120 KB gzip.

The hero headline SHALL be in the HTML, so first contentful and largest contentful paint never wait for JavaScript.
Cumulative layout shift SHALL be 0. LCP SHALL be under 2.5 s on throttled mobile (Fast 3G-class).

#### Scenario: Budget enforced
- **WHEN** `verify-build` runs on a production build
- **THEN** it prints the measured gzip sizes and fails if any budget is exceeded, or if the landing graph includes React, viem or vault code

#### Scenario: LCP without JS
- **WHEN** the landing HTML is fetched without executing scripts
- **THEN** it contains the hero headline and every section's text

#### Scenario: Lab metrics
- **WHEN** Lighthouse (mobile, simulated Fast 3G-class throttling) runs against the production build
- **THEN** CLS is 0 and LCP is under 2.5 s, and the numbers are recorded in the repository

### Requirement: Landing accessibility and keyboard use
The landing page SHALL meet WCAG 2.2 AA:
- one `h1`;
- landmarks;
- a skip link;
- a visible focus ring on every link and control;
- touch targets of at least 44×44 CSS px for nav and CTAs;
- a keyboard-operable navigation menu at narrow widths.

#### Scenario: Axe and keyboard
- **WHEN** an axe WCAG 2.2 A/AA audit runs on the landing page at desktop and phone widths, and the page is traversed with Tab
- **THEN** there are no violations, every focused element shows a visible focus indicator, and Tab reaches the "Open the app" link and every footer link

### Requirement: Pinned scroll scenes
Each story scene SHALL be a stage that stays in view (sticky) while its scroll track passes. The stage's visuals SHALL
be driven by scroll progress, from 0 to 1, using transforms and opacity only. Scenes SHALL use native scrolling:
nothing may intercept wheel, touch or keyboard scrolling. On narrow screens, scenes SHALL use shorter tracks and
simplified visuals.

#### Scenario: Scrubbed by scroll
- **WHEN** the user scrolls to 10% and to 90% of a scene's track
- **THEN** the scene's progress value reflects the position (low, then high) and its visual state differs accordingly, while the scene heading stays visible

#### Scenario: No scroll trap
- **WHEN** the user scrolls through the whole page with the keyboard (Page Down/Space) on desktop and with touch on a phone viewport
- **THEN** the page reaches the footer without any scene blocking or redirecting the scroll

### Requirement: Honest drama
Scene copy SHALL describe only what CryoShield does. Permanence claims MUST name what they depend on: the vault
remains readable while the chain or the Arweave copy exists, and while at least one key works. Copy MUST NOT state or
imply guaranteed, forever, or unbreakable storage. The word "forever" MAY appear only in the FAQ question "How do I
back up my seed phrase forever?" and in the negation "No backup lasts forever" that opens its answer; that answer
SHALL name the chain and Arweave dependency, the need for a working key, and the testnet status. "Never lose" MUST NOT
appear anywhere on the page, its metadata or its structured data.

#### Scenario: Permanence caveat
- **WHEN** the timeline scene is rendered
- **THEN** its visible text names the chain and Arweave dependency and the need for a working key, and the copy contains none of "guaranteed", "forever", "unbreakable", "never lose"

#### Scenario: Forever only as an honest question
- **WHEN** the two allowed "forever" phrases are removed from the landing page's visible text, title, description and JSON-LD
- **THEN** none of "guaranteed", "forever", "unbreakable", "never lose" remains, and the "forever" answer names the blockchain, Arweave, a working key and the testnet

### Requirement: Honest comparison with cloud storage
The "Only you can read it." tile SHALL contain a `<table>` with a `<caption>`, column headers "Typical cloud storage"
and "CryoShield", and these rows:
- who can read your data;
- account and password to lose or have hacked;
- can be frozen, deleted or shut down;
- works if the company disappears.

Under the table it SHALL show the disclaimer that some password managers also encrypt end to end. The tile MUST NOT
say the data stays on the user's device, and MUST NOT name a competitor.

#### Scenario: Table and disclaimer present
- **WHEN** the landing page HTML is checked
- **THEN** the tile has the table, caption, headers and four rows, and the sentence beginning "Some password managers also encrypt end to end." directly follows the table

#### Scenario: No overclaim
- **WHEN** the tile's text is checked
- **THEN** it does not match "stays on your device", "never leaves your device" or a list of competitor names

### Requirement: Comparison reveal respects reduced motion
The table rows SHALL reveal one by one when the table scrolls into view, using transforms and opacity only. With
reduced motion or without JavaScript, every row SHALL be visible immediately and nothing SHALL animate.

#### Scenario: Reduced motion
- **WHEN** the page loads with `prefers-reduced-motion: reduce` and the table is scrolled into view
- **THEN** every row is visible with full opacity and no animation runs

### Requirement: Search metadata on public pages
Every public page (`/`, `/architecture`, `/devices`, `/support`, `/privacy`, `/terms`, `/cookies`) SHALL have:
- a `<title>` of at most 60 characters;
- a `<meta name="description">` of 150 to 160 characters;
- `<link rel="canonical">` with an absolute URL on `https://cryoshield.app` equal to the page's clean path;
- Open Graph tags `og:type`, `og:site_name`, `og:title`, `og:description`, `og:url` (the canonical URL), `og:image`
  (`https://cryoshield.app/og-image.png`), `og:image:width` 1200, `og:image:height` 630 and `og:image:alt`;
- Twitter card tags `twitter:card` (`summary_large_image`), `twitter:title`, `twitter:description`, `twitter:image`
  and `twitter:image:alt`.

The landing title and description SHALL name seed phrase backup and 2FA backup codes. The build MUST fail if a public
page lacks a title or description or breaks the length limits.

#### Scenario: Every public page tagged
- **WHEN** the production build is inspected
- **THEN** each public page has exactly one title, description and canonical link within the limits above, and its OG and Twitter title and description equal its title and description

#### Scenario: Missing description fails the build
- **WHEN** a public page's HTML has no meta description, or one of 120 characters
- **THEN** the build fails and names the page

### Requirement: Share image
The site SHALL serve `/og-image.png`, a 1200×630 PNG built offline from the committed brand SVG
(`brand/og-image.svg`) and the self-hosted Inter font, with no runtime fetch. It SHALL use only the brand's colours
and say "Testnet preview".

#### Scenario: Share image present
- **WHEN** the build output is inspected
- **THEN** `og-image.png` exists, is 1200×630 and matches the hash recorded in `brand/og-image.sha256`

### Requirement: Structured data and visible FAQ
The landing page SHALL carry one JSON-LD block with a `SoftwareApplication` (name CryoShield, `applicationCategory`
`SecurityApplication`, a free `Offer`, `isAccessibleForFree` true, the MIT license), an `Organization` (an
open-source project, `sameAs` the GitHub repository URL) and a `FAQPage`. The FAQ section SHALL be visible text in
`<details>`/`<summary>` disclosures under an `h2`, and SHALL include "How do I back up my seed phrase forever?", "Where
should I store 2FA backup codes?", "What happens if I lose my YubiKey?", "Can CryoShield read my secrets?" and "What if
CryoShield disappears?". The `FAQPage` questions and answers MUST equal the visible FAQ's text, in order. Other pages
MUST NOT carry a script element for structured data.

#### Scenario: JSON-LD matches the visible FAQ
- **WHEN** the built landing page's JSON-LD is parsed
- **THEN** it is valid JSON containing the three types, and its `FAQPage` entries equal the visible `<summary>` and answer texts

### Requirement: JSON-LD under the strict CSP
JSON-LD SHALL be a non-executed data block: the opening tag MUST be exactly `<script type="application/ld+json">` and
the body MUST be valid JSON containing no `<`. The CSP MUST stay unchanged. The inline-script guards (`injectCsp`,
`verify-build`) SHALL accept only such blocks and SHALL still reject every other inline script, including other `type`
values, extra attributes and malformed bodies.

#### Scenario: No violation on load
- **WHEN** the built landing page loads in a browser
- **THEN** no CSP or Trusted Types violation is reported and the JSON-LD block parses

#### Scenario: Other inline scripts still rejected
- **WHEN** a page contains `<script>…</script>`, `<script type="application/json">`, `<script type="application/ld+json" onload="…">` or an ld+json block with a body that is not JSON
- **THEN** `injectCsp` throws and `verify-build` fails

### Requirement: Crawl files
The build SHALL emit `robots.txt` allowing all crawlers, disallowing `/app/`, and naming
`Sitemap: https://cryoshield.app/sitemap.xml`; it MUST NOT disallow `/`. It SHALL emit `sitemap.xml` listing exactly
the public pages' canonical URLs. It SHALL emit `llms.txt` in the llmstxt.org format: a `# CryoShield` heading, the
landing page's meta description as the summary, a status paragraph stating the testnet and unaudited status, one link
per public page with that page's title and meta description (taken from the page's HTML), and links to the source
repository, the vault format specification, the system design and the recovery tool. `llms.txt` MUST NOT list
`/app/`, and its text MUST pass the landing page's honesty denylist. The build MUST fail if `llms.txt` is missing,
omits a public page, or mentions `/app/`.

#### Scenario: robots and sitemap in the build
- **WHEN** the build output is inspected
- **THEN** `robots.txt` and `sitemap.xml` exist, the sitemap is valid XML listing the seven canonical URLs, and `/app/` is not in it

#### Scenario: llms.txt in the build
- **WHEN** the build output is inspected
- **THEN** `llms.txt` exists, starts with `# CryoShield`, links each of the seven canonical URLs with its page's title and description, and does not mention `/app/`

#### Scenario: llms.txt follows the pages
- **WHEN** a public page's title or meta description changes
- **THEN** the next build's `llms.txt` carries the new text without a separate edit

### Requirement: The app is not indexed
`/app/` SHALL carry `<meta name="robots" content="noindex">` and SHALL NOT appear in the sitemap. No public page MUST
carry `noindex`. The build MUST fail otherwise.

#### Scenario: App noindex
- **WHEN** the built `app/index.html` is read
- **THEN** it has the noindex robots meta, and no public page does

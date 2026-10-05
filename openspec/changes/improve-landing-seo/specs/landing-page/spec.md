# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
the public pages' canonical URLs.

#### Scenario: robots and sitemap in the build
- **WHEN** the build output is inspected
- **THEN** `robots.txt` and `sitemap.xml` exist, the sitemap is valid XML listing the seven canonical URLs, and `/app/` is not in it

### Requirement: The app is not indexed
`/app/` SHALL carry `<meta name="robots" content="noindex">` and SHALL NOT appear in the sitemap. No public page MUST
carry `noindex`. The build MUST fail otherwise.

#### Scenario: App noindex
- **WHEN** the built `app/index.html` is read
- **THEN** it has the noindex robots meta, and no public page does

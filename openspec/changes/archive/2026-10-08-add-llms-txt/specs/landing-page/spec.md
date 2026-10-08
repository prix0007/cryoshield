# Spec Delta

## MODIFIED Requirements

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

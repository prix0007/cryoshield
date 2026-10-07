# architecture-page Specification

## Purpose
Publishes CryoShield's system design (trust boundaries, key derivation, flows, delivery pipeline, live reference
values) as a static, accessible page on cryoshield.app whose live values cannot drift from the deployment.

## Requirements

### Requirement: System design page
The site SHALL serve a static page at `/architecture` with:
- the heading "CryoShield system map";
- three figures (components and trust boundaries, key derivation, delivery pipeline), each an inline SVG with
  `role="img"`, an `aria-label` and a `figcaption`;
- the create and unlock step lists;
- a reference-values table.

It SHALL use the site's nav and footer, load no script and no third-party resource, and carry the app CSP and the
standard security headers.

#### Scenario: Page served
- **WHEN** `/architecture` and `/architecture/` are requested from the container
- **THEN** each returns 200 with `Cache-Control: no-cache`, the app CSP and every security header, and `/architecture/x` returns 404

#### Scenario: Accessible figures
- **WHEN** the built page is checked
- **THEN** it has three `svg[role="img"]` with non-empty `aria-label`, each inside a `figure` with a `figcaption`, and arrow-marker ids are unique on the page

### Requirement: CSP-clean markup
The page MUST contain no `style` attribute, no `<style>` element, no `<script>`, and no CSS `var()` inside SVG
attributes. Colours SHALL come from the site's tokens, with both light and dark appearances.

#### Scenario: No inline styles
- **WHEN** the built HTML is scanned
- **THEN** it matches none of `style=`, `<style`, `<script` or `="var(`

### Requirement: Live values from the deployment
The page's network name, chain ID, VaultRegistry address and deploy block SHALL be rendered at build time from
`contracts/deployments/<VITE_CHAIN_ID>.json`, and the RP ID from the build configuration.

#### Scenario: Freshness guard
- **WHEN** the build for a chain is checked
- **THEN** the page shows exactly that deployment file's address, deploy block and chain ID, and the configured RP ID

### Requirement: Reflow and theme
At 390 px wide the page SHALL NOT scroll horizontally. Wide figures SHALL scroll inside a keyboard-focusable
container. The page SHALL pass axe (WCAG 2.2 AA) in both light and dark colour schemes.

#### Scenario: Phone and dark mode
- **WHEN** the page is loaded at 390 px, and in dark mode at 1280 px
- **THEN** the document has no horizontal overflow and axe reports no violations in either scheme

### Requirement: Linked from the site
The landing footer and the "How it works" scene, the legal-page header, and the `/app/` footer SHALL link to
`/architecture`.

#### Scenario: Links present
- **WHEN** the landing page, a legal page and the app shell are rendered
- **THEN** each contains a link to `/architecture`

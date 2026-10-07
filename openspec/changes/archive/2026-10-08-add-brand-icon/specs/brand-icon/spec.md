# Spec Delta

## Purpose

Gives cryoshield.app one recognisable icon everywhere (tabs, bookmarks, home screens, installed app) derived from the
nav shield, legible at 16 px, served from the site's own origin without loosening the CSP.

## ADDED Requirements

### Requirement: Icon set
The site SHALL serve the following from its own origin:
- `favicon.svg`;
- `favicon.ico` (with 16, 32 and 48 px images);
- `apple-touch-icon.png` (180×180, opaque);
- `icon-192.png` and `icon-512.png`;
- `icon-maskable-512.png`, with the mark inside the central 80% safe zone.

All of them SHALL use the shield-and-snowflake mark in the single Action Blue accent, with no gradients.

#### Scenario: Files and sizes
- **WHEN** the icon files are inspected
- **THEN** each exists with the stated pixel dimensions, the ICO contains 16, 32 and 48 px images, and the apple-touch icon has no transparent pixels

### Requirement: Light and dark favicon
`favicon.svg` SHALL switch its colours with an inline `@media (prefers-color-scheme: dark)` rule. It MUST contain no
script, no event-handler attribute, no `foreignObject`, and no reference to any external resource.

#### Scenario: Safe adaptive SVG
- **WHEN** `favicon.svg` is checked
- **THEN** it contains a `prefers-color-scheme: dark` rule, and no `<script`, `on*=` attribute, `foreignObject`, `href`/`xlink:href`, `url(` or `@import`

### Requirement: Web app manifest
The site SHALL serve `site.webmanifest` as `application/manifest+json`. It SHALL have:
- `name` and `short_name`;
- `start_url` `/app/`;
- `theme_color` and `background_color` taken from the design tokens;
- the 192, 512 and maskable icons.

#### Scenario: Manifest served
- **WHEN** the container serves `/site.webmanifest`
- **THEN** it returns 200 with `Content-Type: application/manifest+json`, every security header, and JSON whose icons resolve to files that exist

### Requirement: Linked on every page
Every HTML page (`/`, `/app/`, `/privacy`, `/terms`, `/cookies`) SHALL link the SVG icon, the ICO, the apple-touch
icon and the manifest, and SHALL carry `theme-color` meta tags for light and dark.

#### Scenario: Head tags present
- **WHEN** the built pages are checked
- **THEN** each has `rel="icon"` for `/favicon.svg` (type `image/svg+xml`) and `/favicon.ico`, `rel="apple-touch-icon"`, `rel="manifest"`, and two `theme-color` metas with `prefers-color-scheme` media

### Requirement: Reproducible rasters
The PNG and ICO files SHALL be generated from the committed SVG sources by a committed script that uses only already
pinned dependencies and needs no install script. Their SHA-256 values SHALL be committed, and a test SHALL fail if a
file no longer matches its recorded hash.

#### Scenario: Hash check
- **WHEN** an icon binary is replaced by different bytes without updating the recorded hashes
- **THEN** the icon test fails, naming the file

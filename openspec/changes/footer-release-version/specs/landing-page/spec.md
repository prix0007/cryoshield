# Spec Delta

## ADDED Requirements

### Requirement: Release version in the footer
The landing footer SHALL end with a `Version` line that names the running release. The line SHALL be hidden in the
served HTML and shown only after the page has fetched `/release.json` from its own origin and validated it (a 40-hex
`commit`; a `release` that is `null` or a `vX.Y.Z[-prerelease]` tag). On production it SHALL show the tag and link
it to that GitHub release; on development it SHALL show `dev` and the 7-character commit and link it to that commit.
The text and link MUST be set from the validated values only (`textContent`, `href`), never from markup, and the
fetch MUST NOT delay or alter anything else on the page. The release name MUST NOT be embedded in the build.

#### Scenario: Production footer
- **WHEN** `/release.json` reports `release: "v1.0.3"`
- **THEN** the footer shows "Version v1.0.3", linking to `https://github.com/prix0007/cryoshield/releases/tag/v1.0.3`

#### Scenario: Development footer
- **WHEN** `/release.json` reports `release: null` and a commit
- **THEN** the footer shows "Version dev <7 hex>", linking to that commit on GitHub

#### Scenario: Unknown release
- **WHEN** `/release.json` is missing, times out, or has an unexpected shape
- **THEN** the line stays hidden and nothing else changes

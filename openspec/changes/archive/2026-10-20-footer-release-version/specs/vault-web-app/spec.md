# Spec Delta

## ADDED Requirements

### Requirement: Release version in the app footer
The `/app` footer SHALL show the same `Version` line as the landing page (the release tag on production linking to
the GitHub release, `dev` plus the 7-character commit on development linking to the commit), fetched from
`/release.json` after the app has rendered, through the services container so tests can supply it. The code that
fetches and validates it SHALL NOT be part of the app's initial JavaScript. When the release is unknown the footer
SHALL show no such line.

#### Scenario: App footer on production
- **WHEN** `/app/` opens on a site whose `/release.json` reports `release: "v1.0.3"`
- **THEN** the footer shows "Version v1.0.3" linking to that GitHub release, after the rest of the app has rendered

#### Scenario: App footer with no release information
- **WHEN** the release service resolves to nothing
- **THEN** the footer shows its links and no `Version` line

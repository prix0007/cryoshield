# Spec Delta

## ADDED Requirements

### Requirement: Public release identity
The site SHALL serve `/release.json` with `Cache-Control: no-store` and every security header. It SHALL contain the deployed git commit (40 hex), the release `treeHash`, and the public configuration summary, and nothing secret. The `treeHash` covers every served file except `/release.json` itself, so a rebuild of the commit still reproduces it.

#### Scenario: Which commit is live
- **WHEN** anyone requests `https://cryoshield.app/release.json`
- **THEN** they get the deployed commit and tree hash, uncached, with no API keys or policy IDs

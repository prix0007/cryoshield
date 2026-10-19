# Spec Delta

## MODIFIED Requirements

### Requirement: Public release identity
The site SHALL serve `/release.json` with `Cache-Control: no-store` and every security header. It SHALL contain the deployed git commit (40 hex), the release name `release` (the `vX.Y.Z[-prerelease]` tag the production deploy ran at, or `null` on the development site), the release `treeHash`, and the public configuration summary, and nothing secret. The `treeHash` covers every served file except `/release.json` itself, so a rebuild of the commit still reproduces it, and the release name MUST NOT be part of the built files: the same commit builds to the same tree on both targets.

A production build SHALL refuse to proceed when it cannot name exactly one well-formed release tag (the run's own `v*` tag ref in CI, or the single `v*` tag at `HEAD` locally). A development build SHALL never name one.

#### Scenario: Which commit is live
- **WHEN** anyone requests `https://cryoshield.app/release.json`
- **THEN** they get the deployed commit, the release tag and tree hash, uncached, with no API keys or policy IDs

#### Scenario: Development names no release
- **WHEN** anyone requests `https://cryoshield-web-dev.fly.dev/release.json`
- **THEN** `release` is `null` and `commit` names `main`'s deployed commit

#### Scenario: Production build without a tag
- **WHEN** `deploy.sh` runs for production at a commit with no `v*` tag, or with two
- **THEN** it refuses before the manifest is written, naming the problem

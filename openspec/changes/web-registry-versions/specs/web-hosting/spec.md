# Spec Delta

## ADDED Requirements

### Requirement: Release registry list
`/release.json` and the release manifest SHALL list every registry of the build in `config.registries` as
`{version, address, deployBlock, abiHash}`, newest first, read from the deployment record with the same parser as the
build. They SHALL keep `config.registry` (v1, or null) and `config.registryV2` with the same values for as long as a
deploy check or a supported recovery-tool version reads them.

#### Scenario: Three registries
- **WHEN** the record lists v3, v2 and v1
- **THEN** `config.registries` lists v3, v2 and v1 in that order, and `config.registry` and `config.registryV2` equal
  the v1 and v2 entries

#### Scenario: Unknown version
- **WHEN** the record lists a version whose `abiHash` the app doesn't know
- **THEN** the manifest step fails instead of publishing it

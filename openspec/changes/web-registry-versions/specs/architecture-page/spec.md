# Spec Delta

## MODIFIED Requirements

### Requirement: Live values from the deployment
The page's network name, chain ID, every VaultRegistry version's address (one row per version, newest first, older ones
marked read-only) and the newest registry's deploy block SHALL be rendered at build time from
`contracts/deployments/<VITE_CHAIN_ID>.json`, and the RP ID from the build configuration.

#### Scenario: Freshness guard
- **WHEN** the build for a chain is checked
- **THEN** the page shows exactly that deployment file's registry versions and addresses, the newest registry's deploy
  block and the chain ID, and the configured RP ID

#### Scenario: A new registry version
- **WHEN** the record gains `contracts.vaultRegistries.v3`
- **THEN** the page shows a "VaultRegistry v3" row first, and v2 and v1 as read-only

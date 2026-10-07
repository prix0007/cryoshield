# Spec Delta

## ADDED Requirements

### Requirement: Networks without VaultRegistry v1
On a network whose deployment record has no VaultRegistry v1 entry (OP Mainnet), the architecture page SHALL state that VaultRegistry v1 does not exist on that network, instead of an empty or placeholder value, and SHALL show the network name, chain ID, VaultRegistry v2 address and deploy block, and the wallet factory and implementation for the build's RP ID from that record.

#### Scenario: Mainnet architecture page
- **WHEN** `/architecture` is built for chain 10 from a record with only `contracts.vaultRegistryV2` and `contracts.wallets["cryoshield.app"]`
- **THEN** it shows "OP Mainnet", chain ID 10, those addresses and deploy block, and "none on this network" for VaultRegistry v1, and no placeholder token remains in the page

# Spec Delta

## MODIFIED Requirements

### Requirement: Per-chain deployment records
Each deployment SHALL write `contracts/deployments/<chainId>.json`. For VaultRegistry v1 the top-level fields `{chainId, address, deployBlock, txHash, abiHash}` are kept for compatibility. Every other contract SHALL have an entry under `contracts.<name>` (`vaultRegistryV2`, `attestationRegistry`, `paymaster`), each with `{address, deployBlock, txHash, abiHash}`. The web app and the recovery tool SHALL read each address and deploy block for their selected chain only from that record, or from a preset generated from it. A missing record, or a missing entry the component needs, SHALL be a build-time or startup error, not a silent fallback to another chain or contract.

#### Scenario: Web build for a chain without a record
- **WHEN** the web app is built with `VITE_CHAIN_ID=11155420` and `contracts/deployments/11155420.json` does not exist
- **THEN** the build fails with a message naming the missing file

#### Scenario: Missing paymaster entry
- **WHEN** the web app is built for a chain whose record has no `contracts.paymaster` entry
- **THEN** the build fails with a message naming the missing entry, and the app never falls back to another sponsor

#### Scenario: Chain without v1
- **WHEN** a record has no top-level v1 address (for example OP Mainnet)
- **THEN** readers use only `contracts.vaultRegistryV2`

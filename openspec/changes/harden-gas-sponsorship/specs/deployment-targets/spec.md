# Spec Delta

## MODIFIED Requirements

### Requirement: Per-chain deployment records
Each deployment SHALL write `contracts/deployments/<chainId>.json`. VaultRegistry v1 keeps the top-level fields `{chainId, address, deployBlock, txHash, abiHash}` for compatibility, only on chains where v1 exists. VaultRegistry v2 SHALL have the entry `contracts.vaultRegistryV2 = {address, deployBlock, txHash, abiHash}`.

Wallet deployments SHALL be keyed by RP ID, because the implementation bakes in `sha256(rpId)` and several builds may share one chain. The entry SHALL be `contracts.wallets.<rpId> = {implementation, factory, deployBlock, txHash, abiHash}`, where `implementation` and `factory` are addresses.

The web app SHALL select its wallet entry by `VITE_RP_ID`. The web app and the recovery tool SHALL read every address and deploy block for their selected chain only from that record, or from a preset generated from it. A missing record, or a missing entry the component needs (including no wallet entry for the build's RP ID), SHALL be a build-time or startup error, never a silent fallback to another chain, another RP ID's wallet, or Coinbase's factory.

#### Scenario: Web build for a chain without a record
- **WHEN** the web app is built with `VITE_CHAIN_ID=11155420` and `contracts/deployments/11155420.json` does not exist
- **THEN** the build fails with a message naming the missing file

#### Scenario: Two RP IDs on one chain
- **WHEN** `11155420.json` holds `contracts.wallets["cryoshield.app"]` and `contracts.wallets["cryoshield-web-dev.fly.dev"]`, and the production build (`VITE_RP_ID=cryoshield.app`) and the dev build (`VITE_RP_ID=cryoshield-web-dev.fly.dev`) both run for chain 11155420
- **THEN** both builds succeed, and each uses only the factory and implementation under its own RP ID

#### Scenario: Missing wallet entry for the build's RP ID
- **WHEN** the web app is built for a chain whose record has no `contracts.wallets.<VITE_RP_ID>` entry
- **THEN** the build fails with a message naming the RP ID and the record, even if entries for other RP IDs exist

#### Scenario: Chain without v1
- **WHEN** a record has no top-level v1 address (OP Mainnet)
- **THEN** readers use only `contracts.vaultRegistryV2`

### Requirement: Dependency availability on target chains
A network SHALL be marked deployable only when the following are verified on that chain, with the verification method and date recorded:
- the RIP-7212 P-256 precompile at `0x100`;
- EntryPoint v0.6 at `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`;
- the CREATE2 deployer used by the deploy tooling.

After deployment, the CryoShield wallet implementation and factory for every configured RP ID SHALL be checked, in each chain's record, to have the bytecode built from the reviewed source. On chains with legacy CBSW v1.1 accounts (OP Sepolia only), the CBSW v1.1 implementation those accounts use SHALL also be checked, so the in-place upgrade path stays testable. Coinbase's CBSW v1.1 factory SHALL NOT be a dependency for new accounts.

#### Scenario: Fixture bytecode parity
- **WHEN** the E2E chain fixtures are regenerated from OP Sepolia
- **THEN** the EntryPoint v0.6 and CBSW v1.1 implementation bytecode match the committed fixtures byte for byte, and each `contracts.wallets.<rpId>` implementation and factory match the bytecode compiled from the pinned source with that RP ID; any difference is reported and blocks the change

#### Scenario: Mainnet has no v1 dependency
- **WHEN** OP Mainnet is checked for deployability
- **THEN** no VaultRegistry v1 or Coinbase-factory check is required, and only VaultRegistry v2 and the `cryoshield.app` wallet pair are expected in its record

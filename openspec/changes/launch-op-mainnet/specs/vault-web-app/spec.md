# Spec Delta

## ADDED Requirements

### Requirement: Network status notice in the app
The app shell SHALL show a network status notice on every network: on a test network, the existing testnet and unaudited banner; on OP Mainnet, a notice that CryoShield has not been independently audited and that losing all enrolled keys means losing the vault. For 90 days after the configured launch date, a mainnet build's "no vault found" state SHALL explain that vaults created during the testnet preview are not on OP Mainnet, that they remain readable with the recovery tool using `--testnet`, and that the user can create a new vault.

#### Scenario: Mainnet app shell
- **WHEN** the app built for chain 10 is opened
- **THEN** an "unaudited" notice is visible, and no "Testnet" chip or testnet banner is shown

#### Scenario: Testnet vault guidance after the switch
- **WHEN** a user on a chain-10 build within 90 days of the launch date unlocks with a key that has no vault on OP Mainnet
- **THEN** the "no vault found" state names the testnet preview, the recovery tool's `--testnet` option, and creating a new vault

#### Scenario: Unknown chain fails safe
- **WHEN** the app is built for a chain ID with no known status
- **THEN** the testnet and unaudited banner is shown

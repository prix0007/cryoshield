# Spec Delta

## ADDED Requirements

### Requirement: Network and audit status in legal text
The terms, privacy and cookie pages SHALL name the network the build targets, taken from the build's chain ID, and SHALL state on every network that CryoShield has not been independently audited and that nobody, including CryoShield, can open a vault after all of its enrolled keys are lost. On a test network the terms SHALL also say it is a test network. The privacy policy's blockchain and RPC sub-processor rows SHALL name the build's network and the host of the configured `VITE_RPC_URL`. Any change to this text SHALL update the legal version and "last updated" date.

#### Scenario: Mainnet legal pages
- **WHEN** `/terms` and `/privacy` are built for chain 10 with `VITE_RPC_URL=https://mainnet.optimism.io`
- **THEN** both name "OP Mainnet", both contain the unaudited and all-keys-lost statements, neither says "OP Sepolia" or "testnet preview", and the privacy sub-processor table lists `mainnet.optimism.io`

#### Scenario: Testnet legal pages unchanged in substance
- **WHEN** `/terms` is built for chain 11155420
- **THEN** it states that CryoShield runs on OP Sepolia, a test network, and has not been independently audited

#### Scenario: RPC origin must be disclosed
- **WHEN** a build's `VITE_RPC_URL` host is missing from the privacy sub-processor table
- **THEN** the build's origins check fails and names the host

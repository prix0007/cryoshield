# Spec Delta

## ADDED Requirements

### Requirement: OP Mainnet preset from the deployment record
The recovery tool's `op-mainnet` preset SHALL carry the VaultRegistry v2 address and deploy block from `contracts/deployments/10.json`, generated at release time, and SHALL carry no VaultRegistry v1 address. A release made while no `10.json` exists SHALL keep blockchain lookup off for `op-mainnet` and say so, as for any network without a deployment.

#### Scenario: Preset parity with the record
- **WHEN** the recovery tool's tests run with `contracts/deployments/10.json` present
- **THEN** the `op-mainnet` preset's v2 address and deploy block equal `contracts.vaultRegistryV2` in that file, and its v1 registry is the placeholder

#### Scenario: v2-only network
- **WHEN** the tool looks up a vault on a network preset with VaultRegistry v2 and no v1
- **THEN** it reads only v2, finds and opens the vault, and makes no v1 call

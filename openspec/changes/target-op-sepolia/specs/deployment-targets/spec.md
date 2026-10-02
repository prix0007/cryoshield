# Spec Delta

## Purpose
Defines which networks CryoShield can be deployed to and read from, how each component selects a network, and which network is the default testnet. A chain is configuration, never code.

## ADDED Requirements

### Requirement: Supported network presets
The project SHALL support these named network presets, each defining a chain ID, at least three independent public read RPC endpoints (except `anvil`), and an explorer-verification target:
- `anvil` (31337)
- `op-sepolia` (11155420)
- `op-mainnet` (10)
- `arbitrum-sepolia` (421614)
- `arbitrum-one` (42161)

The deploy tooling and the recovery tool SHALL use the same chain IDs for the same preset names. No component SHALL contain chain-specific logic beyond preset data.

#### Scenario: Presets agree across components
- **WHEN** the deploy tooling's and the recovery tool's preset tables are compared in a test
- **THEN** every preset name present in both maps to the same chain ID

#### Scenario: Unknown network rejected
- **WHEN** a user selects a network name that is not a preset
- **THEN** the tool exits non-zero with a message listing the valid preset names

### Requirement: OP Sepolia is the default testnet
OP Sepolia (chain 11155420) SHALL be the testnet used for the first public deployment. Every place that names "the testnet" SHALL resolve to `op-sepolia`: the example web configuration, the deploy instructions, the recovery tool's `--testnet` shorthand, and the hardware-test checklist.

#### Scenario: Testnet shorthand
- **WHEN** the recovery tool runs with `--testnet`
- **THEN** it uses chain 11155420 and the `op-sepolia` built-in RPC list

#### Scenario: Example web configuration
- **WHEN** a developer copies `apps/web/.env.example` without edits other than secrets
- **THEN** the build targets chain 11155420 with an OP Sepolia public RPC and a Pimlico OP Sepolia endpoint

### Requirement: Recovery tool default network
The recovery tool SHALL have exactly one default network, defined as a single named constant. Until the mainnet chain is decided, that default SHALL be `op-sepolia`. The default SHALL change only through an OpenSpec change.

#### Scenario: No network flag
- **WHEN** the recovery tool runs without `--network`, `--testnet`, `--chain-id`, or `--rpc`
- **THEN** it uses the `op-sepolia` preset and prints which network it is using

### Requirement: Chain ID verification before use
Every component SHALL verify a configured RPC's chain ID against the selected preset before reading or writing. It SHALL refuse to proceed on a mismatch.

#### Scenario: Deploy against the wrong chain
- **WHEN** the deploy tooling is run for `op_sepolia` with an RPC that reports a chain ID other than 11155420
- **THEN** it exits non-zero before sending or simulating any transaction

### Requirement: Explorer verification with a single key
Deployments to public networks SHALL verify the contract source on the chain's Etherscan-family explorer, using one Etherscan V2 API key supplied only through the environment variable `ETHERSCAN_API_KEY`, never through command-line arguments. Raw private keys SHALL remain refused for public networks; only a named Foundry keystore is accepted.

#### Scenario: Verification key not in argv
- **WHEN** a broadcast deployment to `op_sepolia` runs
- **THEN** the process arguments contain neither the API key nor any private key

#### Scenario: Missing key on broadcast
- **WHEN** `BROADCAST=1` is set and `ETHERSCAN_API_KEY` is unset
- **THEN** the tooling exits non-zero before broadcasting

### Requirement: Per-chain deployment records
Each deployment SHALL write `contracts/deployments/<chainId>.json` containing `{chainId, address, deployBlock, txHash, abiHash}`. The web app and the recovery tool SHALL read the registry address and deploy block for their selected chain only from that record, or from a preset generated from it. A missing record for the selected chain SHALL be a build-time or startup error, not a silent fallback to another chain.

#### Scenario: Web build for a chain without a record
- **WHEN** the web app is built with `VITE_CHAIN_ID=11155420` and `contracts/deployments/11155420.json` does not exist
- **THEN** the build fails with a message naming the missing file

### Requirement: Dependency availability on target chains
A network SHALL be marked deployable only when the following are verified on that chain, with the verification method and date recorded:
- the RIP-7212 P-256 precompile at `0x100`;
- EntryPoint v0.6 at `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`;
- the Coinbase Smart Wallet v1.1 factory and the implementation the web app uses;
- the CREATE2 deployer used by the deploy tooling.

#### Scenario: Fixture bytecode parity
- **WHEN** the E2E chain fixtures are regenerated from OP Sepolia
- **THEN** the EntryPoint v0.6 and Coinbase Smart Wallet v1.1 bytecode match the previously committed fixtures byte for byte, or the difference is reported and blocks the change

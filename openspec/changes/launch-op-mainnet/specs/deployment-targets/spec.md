# Spec Delta

## MODIFIED Requirements

### Requirement: Recovery tool default network
The recovery tool SHALL have exactly one default network, defined as a single named constant. From the recovery-tool release that ships with the OP Mainnet launch, that default SHALL be `op-mainnet`; `--testnet` SHALL keep selecting `op-sepolia`. The tool SHALL print which network it is using. The default SHALL change only through an OpenSpec change.

#### Scenario: No network flag
- **WHEN** the recovery tool runs without `--network`, `--testnet`, `--chain-id`, or `--rpc`
- **THEN** it uses the `op-mainnet` preset and prints which network it is using

#### Scenario: Testnet vaults still reachable
- **WHEN** the recovery tool runs with `--testnet`
- **THEN** it uses chain 11155420 and the `op-sepolia` built-in RPC list and registries

### Requirement: Keyless explorer verification
Deployments to public networks SHALL verify the contract source on the chain's Blockscout explorer and on Sourcify, neither of which needs an API key. Each preset SHALL define its Blockscout verifier API URL. Verification SHALL run only after the deployment record is written: a verification failure SHALL exit non-zero (2), keep the record, and print a retry command. No secret SHALL ever appear in command-line arguments. Raw private keys SHALL remain refused for public networks; only a named Foundry keystore is accepted.

Etherscan-family verification MAY be added as a separate step through the Etherscan V2 API. It SHALL read the API key only from the environment and pass it to the HTTP client through standard input, never through arguments, files in the repository, logs or error messages, and it SHALL never be required for a deployment to succeed.

#### Scenario: No secrets in argv and no API key needed
- **WHEN** a broadcast deployment to `op_sepolia` or `op_mainnet` runs with no explorer API key in the environment
- **THEN** it proceeds, the verify steps use Blockscout (`--verifier blockscout` with that preset's URL) and Sourcify, and the process arguments contain no API key and no private key

#### Scenario: Verifier per preset
- **WHEN** the deploy tooling's broadcast plan is built for each public preset
- **THEN** each uses that chain's own Blockscout verifier URL, and each also queues a Sourcify verification

#### Scenario: Verification failure keeps the record
- **WHEN** the deployment succeeds but source verification fails
- **THEN** `contracts/deployments/<chainId>.json` is written and the tooling exits with a distinct non-zero code (2) and prints the retry command

#### Scenario: Etherscan key never in argv
- **WHEN** the Etherscan V2 verification script runs for chain 10 with `ETHERSCAN_API_KEY` set
- **THEN** it calls `https://api.etherscan.io/v2/api?chainid=10`, and the recorded arguments of every subprocess it starts contain no part of the key, and its output on success or failure contains no part of the key

## ADDED Requirements

### Requirement: OP Mainnet deployment
The OP Mainnet (chain 10) deployment SHALL contain only VaultRegistry v2 and the wallet implementation and factory for the RP ID `cryoshield.app`. VaultRegistry v1 and any other RP ID's wallet pair SHALL NOT be deployed or recorded on chain 10. Because the CREATE2 addresses depend only on the canonical CREATE2 deployer, the constant salts and the init code, the deploy tooling SHALL refuse to simulate or broadcast to `op_mainnet` unless the predicted VaultRegistry v2, `cryoshield.app` factory and implementation addresses equal those recorded in `contracts/deployments/11155420.json`. Broadcasting SHALL remain refused without `CRYOSHIELD_MAINNET_GATE=approved:10`. A contract already present at a predicted address but missing from the record SHALL stop the tooling; it MAY be recorded by hand only after its runtime bytecode is shown to equal the build's.

#### Scenario: Address parity with OP Sepolia
- **WHEN** `deploy.sh op_mainnet` is planned from a build whose predicted addresses equal `11155420.json`
- **THEN** the plan proceeds and lists only the registry v2 and the `cryoshield.app` pair

#### Scenario: Bytecode drift refused
- **WHEN** `deploy.sh op_mainnet` is planned from a build whose predicted registry v2, factory or implementation address differs from `11155420.json`
- **THEN** it exits non-zero before any RPC call and names the contract whose address differs

#### Scenario: Other RP IDs refused on mainnet
- **WHEN** `deploy.sh op_mainnet` runs with `RP_IDS` containing an RP ID other than `cryoshield.app`
- **THEN** it exits non-zero without simulating or sending anything

#### Scenario: Mainnet record contents
- **WHEN** the OP Mainnet deployment record `contracts/deployments/10.json` is read
- **THEN** it has `chainId` 10, `contracts.vaultRegistryV2` and `contracts.wallets["cryoshield.app"]` only, with no top-level v1 `address`

### Requirement: Production chain switch through a release
The production site's chain SHALL change only through the `production-build` environment values (`VITE_CHAIN_ID`, `VITE_RPC_URL`, `VITE_SPONSORSHIP_POLICY_ID` and the `VITE_BUNDLER_URL` secret) followed by a deploy of an owner-published `v*` release. The owner MAY set the new chain's values before publishing that release, so that the release's first production deploy is already on the new chain (founder decision 2026-10-09). In that case the release's commit SHALL have been deployed on the previous chain by the development site (which deploys every `main` commit), and the previous values SHALL be saved offline before they are changed, including the `VITE_BUNDLER_URL` secret, which GitHub cannot return and which is taken from the bundler provider's dashboard. After the switch, only releases whose tree contains the new chain's deployment record SHALL be used as rollback targets; a chain rollback restores the saved values and redeploys a release that contains the previous chain's record.

#### Scenario: First release deploys straight to the new chain
- **WHEN** the owner sets `VITE_CHAIN_ID=10` and the other mainnet values in `production-build` and then publishes release `vA`, which contains `contracts/deployments/10.json` and whose commit the development site has deployed on OP Sepolia
- **THEN** the deploy passes the build, the smoke test and the copy checks, and `/release.json` names chain 10

#### Scenario: Failed first mainnet deploy
- **WHEN** the deploy of `vA` with the chain-10 values fails after `fly deploy` started
- **THEN** the release job rolls back to the previous image (the self-contained OP Sepolia build), and no redeploy succeeds until the values are either fixed or restored

#### Scenario: Pre-mainnet tag cannot be a mainnet rollback target
- **WHEN** a release whose tree has no `contracts/deployments/10.json` is deployed with `VITE_CHAIN_ID=10`
- **THEN** the build fails with a message naming the missing record, and nothing is deployed

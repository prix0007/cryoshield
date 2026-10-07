# Spec Delta

## Purpose

Defines how CryoShield measures product usage without tracking anyone: aggregate metrics computed only from public
on-chain registry events, public Arweave mirror data, and the sponsor's own gas spend, by read-only tooling with no
CryoShield-operated backend.

## ADDED Requirements

### Requirement: Public-data-only metrics source
The metrics tool SHALL read only public data: `VaultCreated`, `VaultUpdated` and `LocatorAdded` logs of the configured
VaultRegistry, EntryPoint `UserOperationEvent` logs, and public Arweave GraphQL. It SHALL use only the public RPC
endpoints of the selected chain preset and SHALL need no secret, API key, wallet or private key.

#### Scenario: Runs with no credentials
- **WHEN** the tool runs for `op-sepolia` in an environment with no secrets and no `.env`
- **THEN** it completes and every outbound request goes to a preset RPC origin or the configured Arweave gateway

#### Scenario: Chain ID mismatch refused
- **WHEN** a configured RPC reports a chain ID different from the selected preset
- **THEN** the tool exits non-zero before reading any logs

### Requirement: Aggregate metrics report
The tool SHALL output one JSON report with: total vaults, vaults created per ISO week, `VaultUpdated` count per week,
the distribution of keys per vault (from the cleartext key count N in each latest blob), weekly active vaults
(distinct vaults with any event in the week), and the chain, registry address and block range read.

#### Scenario: Known fixture
- **WHEN** the tool runs against a local anvil chain seeded with 3 vaults (2, 2 and 3 keys), one updated twice in week W
- **THEN** the report shows `vaults_total = 3`, keys-per-vault `{2: 2, 3: 1}`, `updates[W] = 2`, and `weekly_active[W]` counting distinct vaults

### Requirement: No identifiers in the report
The report SHALL contain only counts, distributions, sums and the registry metadata. It SHALL NOT contain any account
address, vaultId, locator, credential ID, transaction hash, blob bytes, or any per-vault row, even though those values are
public on-chain.

#### Scenario: Report scan
- **WHEN** a test scans the report produced from the fixture chain
- **THEN** no 20-byte or 32-byte hex value other than the registry address appears in it

#### Scenario: Small-cell suppression
- **WHEN** a weekly or distribution bucket holds fewer than 3 vaults on a public network
- **THEN** that bucket is not reported with its exact count: it is merged with the following weeks (or the adjacent categories) until the group holds at least 3, and a group that is still open is reported only as `"<3"`

#### Scenario: No hidden cell recoverable by subtraction
- **WHEN** a reader subtracts published numbers within one report, or compares the reports of successive weeks, on a public network
- **THEN** no group of fewer than 3 vaults (for gas: 3 accounts) can be recovered, because the report stops at the last complete ISO week, a published week range never changes, and no total includes an open group

### Requirement: Arweave mirror coverage metric
The report SHALL include mirror coverage: the share of vaults whose latest on-chain version has an Arweave item tagged
with the same `CryoShield-Vault-Id` and `CryoShield-Version`. An item counts only when its data hash equals the on-chain
`blobHash`.

#### Scenario: Missing mirror
- **WHEN** one of three fixture vaults has no Arweave item for its latest version
- **THEN** coverage is reported as 2 of 3 and the tool exits zero

#### Scenario: Wrong bytes do not count
- **WHEN** an Arweave item has matching tags but data whose keccak256 differs from the on-chain blobHash
- **THEN** that vault is counted as not mirrored

### Requirement: Sponsored gas spend from chain data
The report SHALL include the gas actually paid for vault operations: the sum and per-week totals of `actualGasCost` from
EntryPoint `UserOperationEvent` logs whose `sender` is a vault owner from the registry and whose `paymaster` is one of
the configured sponsor paymaster addresses, in wei and ETH.

#### Scenario: Unsponsored operation excluded
- **WHEN** the fixture includes one vault operation paid without the configured paymaster
- **THEN** its gas cost is excluded from the sponsored total

### Requirement: Read-only scheduled run
A scheduled CI workflow SHALL run the same tool weekly with a read-only token, no secrets, pinned actions, and upload
the JSON report as a workflow artifact. It SHALL never commit, push, deploy, or write anywhere else.

#### Scenario: Workflow permissions
- **WHEN** the workflow file is linted in CI
- **THEN** it declares `permissions: contents: read`, references no `secrets.*`, and every third-party action is pinned by commit SHA

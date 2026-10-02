# Spec Delta

## Purpose

Stores CryoShield's encrypted vault blobs permanently on an EVM chain, maps each enrolled hardware key's locator to its vault, and guarantees that only the vault owner can change a vault and that no one, including CryoShield, can alter, freeze, or delete it.

## ADDED Requirements

### Requirement: Vault creation
The registry SHALL let any caller create a vault from a client-chosen `vaultId` (random 32 bytes or `keccak256(owner, nonce)`), an opaque blob, and an initial list of locators. The caller SHALL be recorded as the vault owner. The `vaultId` is independent of the locators. The registry SHALL NOT parse or interpret the blob.

#### Scenario: Successful creation
- **WHEN** a caller with no existing vault submits an unused non-zero `vaultId`, a 1–1024 byte blob, and 2–8 distinct non-zero locators
- **THEN** the vault is stored with the caller as owner and version 1, and `vaultId` is appended to each locator's index entry

### Requirement: Unique vault identifiers
The registry SHALL allow at most one vault per `vaultId` and SHALL never overwrite or reassign an existing `vaultId`.

#### Scenario: Duplicate vaultId
- **WHEN** a caller submits a `vaultId` that already exists, including one front-run by another caller
- **THEN** the call reverts, the existing vault is unchanged, and the client may retry with a fresh `vaultId`

### Requirement: One vault per owner
The registry SHALL allow each owner address to own at most one vault.

#### Scenario: Second vault from same owner
- **WHEN** an address that already owns a vault attempts to create another
- **THEN** the call reverts

### Requirement: Append-only locator index
Each locator SHALL map to an ordered list of `vaultId`s. Registering a locator SHALL append the vault's `vaultId` to that list, whether or not other vaults already use it. Entries SHALL never be removed, reordered, or overwritten. Each list SHALL hold at most 16 entries. The zero value SHALL NOT be accepted as a locator or `vaultId`.

#### Scenario: Shared locator does not block registration
- **WHEN** a caller registers a locator that already lists another caller's `vaultId`
- **THEN** the call succeeds and the locator's list contains both `vaultId`s in insertion order

#### Scenario: Existing entries survive later appends
- **WHEN** other callers append entries under a locator that already lists a victim's `vaultId`
- **THEN** the victim's entry remains at its original position and resolving the locator still returns it

#### Scenario: Per-locator cap
- **WHEN** an append would bring a locator's list above 16 entries
- **THEN** the call reverts and the existing list is unchanged

#### Scenario: Duplicate within one call
- **WHEN** the same locator appears twice in a single call
- **THEN** the call reverts

#### Scenario: Zero locator
- **WHEN** a caller submits a zero `vaultId` or zero locator
- **THEN** the call reverts

### Requirement: Blob size limit
The registry SHALL reject any blob that is empty or larger than 1024 bytes, on both creation and update.

#### Scenario: Oversized blob
- **WHEN** a caller submits a 1025-byte blob
- **THEN** the call reverts

#### Scenario: Maximum-size blob
- **WHEN** a caller submits exactly 1024 bytes
- **THEN** the write succeeds and the stored blob is byte-identical to the input (test vector: 1024 bytes of 0xA5 round-trips unchanged)

### Requirement: Locator count limit
The registry SHALL cap the total number of locators per vault at 8, counting both the initial locators and later additions. Vault creation SHALL require at least 2 locators.

#### Scenario: Too many locators
- **WHEN** a create or add would bring a vault's locator count above 8
- **THEN** the call reverts

#### Scenario: Locator already on this vault
- **WHEN** an add submits a locator the vault already registered
- **THEN** the call reverts

#### Scenario: Too few locators at creation
- **WHEN** a caller creates a vault with fewer than 2 locators
- **THEN** the call reverts

### Requirement: Owner-only updates
Only the vault owner SHALL be able to replace the vault blob or add locators. Each successful blob update SHALL increment the vault version by exactly 1.

#### Scenario: Owner updates blob
- **WHEN** the owner submits a valid replacement blob
- **THEN** the stored blob is replaced and the version increments by 1

#### Scenario: Non-owner update
- **WHEN** any other address tries to update the blob or add locators
- **THEN** the call reverts and the vault is unchanged

### Requirement: Public permissionless reads
The registry SHALL expose read-only functions that return a vault's owner, blob, and version by `vaultId`, and that resolve a locator to its full list of candidate `vaultId`s. Choosing the candidate that decrypts is the client's job (see `vault-crypto`). Reads SHALL need only a standard `eth_call` to any node: no transaction, signature, or CryoShield infrastructure.

#### Scenario: Recovery read via public RPC
- **WHEN** a client calls resolve-locator then get-vault for each candidate through a public RPC, using only a locator derived from a hardware key
- **THEN** it receives the exact stored blobs without sending a transaction

#### Scenario: Unknown locator
- **WHEN** a client resolves a locator that was never registered
- **THEN** the call returns an empty list without reverting

### Requirement: Change events
The registry SHALL emit `VaultCreated` on creation and `VaultUpdated` on every blob update. Each event SHALL carry the `vaultId`, the new version, and `keccak256` of the stored blob. Adding a locator SHALL emit an event carrying the `vaultId` and the locator.

Every event SHALL carry `vaultId` as an indexed topic, so log readers (the recovery tool, the Arweave mirror) can filter by `vaultId`.

#### Scenario: Event hash matches stored blob
- **WHEN** a vault is created or updated
- **THEN** the emitted hash equals `keccak256` of the blob returned by get-vault for that version

#### Scenario: Filter logs by vaultId
- **WHEN** a reader filters the registry's logs on the first indexed topic equal to a `vaultId`
- **THEN** it receives that vault's `VaultCreated`, every `VaultUpdated`, and every locator-added event, and no other vault's events

### Requirement: Immutability and no privileged control
The registry SHALL have no upgrade mechanism, no admin or owner role, no pause, and no self-destruct. No address other than a vault's owner SHALL be able to change, freeze, or delete that vault.

#### Scenario: Deployer has no special power
- **WHEN** the deploying address attempts to update or delete any vault it does not own
- **THEN** the call reverts exactly as for any other non-owner

### Requirement: Chain portability
The registry SHALL depend on no chain-specific precompiles or system contracts. The same bytecode SHALL behave identically, and deploy to the same CREATE2 address, on OP Sepolia, OP Mainnet, Arbitrum One, Arbitrum Sepolia, and Ethereum L1.

#### Scenario: Same test suite on L1 settings
- **WHEN** the full test suite runs against a mainnet-equivalent EVM configuration
- **THEN** all tests pass without code changes

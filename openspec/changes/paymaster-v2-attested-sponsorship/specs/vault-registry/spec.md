# Spec Delta

## MODIFIED Requirements

### Requirement: Vault creation
The registry SHALL let any caller create a vault from a client-chosen 32-byte `salt`, an opaque blob, and an initial list of locators. The registry SHALL derive the vault identifier as `vaultId = keccak256(abi.encode(msg.sender, salt))` and return it. The caller SHALL be recorded as the vault owner. The `vaultId` is independent of the locators. The registry SHALL NOT parse or interpret the blob. The derivation SHALL match the `vaultIdDerivation` cases in `packages/vault-crypto/test-vectors/v1.json`, which the TypeScript, Python and Solidity tests all check.

#### Scenario: Successful creation
- **WHEN** a caller with no existing vault submits a salt, a 1–1024 byte blob, and 2–8 distinct non-zero locators
- **THEN** the vault is stored under `keccak256(abi.encode(caller, salt))` with the caller as owner and version 1, the id is returned, and it is appended to each locator's index list

#### Scenario: Derivation test vector
- **WHEN** the `vaultIdDerivation` vector's owner address and salt are used
- **THEN** the registry, the web app and the recovery tool all compute the vector's `vaultId`

### Requirement: Unique vault identifiers
The registry SHALL allow at most one vault per `vaultId` and SHALL never overwrite or reassign an existing `vaultId`. Because the identifier is derived from the caller, no caller SHALL be able to create a vault under an identifier derived from another address.

#### Scenario: Squatting impossible
- **WHEN** an attacker copies a pending operation's salt and calls `createVault` first
- **THEN** the attacker's vault gets a different `vaultId`, and the victim's create still succeeds under its own `vaultId`

#### Scenario: Duplicate vaultId
- **WHEN** a caller submits a salt that, with its own address, derives an existing `vaultId` (it reuses its own salt)
- **THEN** the call reverts and the existing vault is unchanged

### Requirement: Append-only locator index
Each locator SHALL map to an ordered list of `vaultId`s. Registering a locator SHALL append the vault's `vaultId` to that list, whether or not other vaults already use it. Entries SHALL never be removed, reordered, or overwritten. There SHALL be no per-locator entry cap. The zero value SHALL NOT be accepted as a locator or `vaultId`.

#### Scenario: Shared locator does not block registration
- **WHEN** a caller registers a locator that already lists another caller's `vaultId`
- **THEN** the call succeeds and the locator's list contains both `vaultId`s in insertion order

#### Scenario: Existing entries survive later appends
- **WHEN** other callers append entries under a locator that already lists a victim's `vaultId`
- **THEN** the victim's entry remains at its original position and resolving the locator still returns it

#### Scenario: Per-locator cap
- **WHEN** a locator already lists any number of entries (tested with 1,000, far above v1's former cap of 16)
- **THEN** a further registration under it succeeds: there is no per-locator cap, so stuffing cannot block a registration

#### Scenario: Duplicate within one call
- **WHEN** the same locator appears twice in a single call
- **THEN** the call reverts

#### Scenario: Zero locator
- **WHEN** a caller submits a zero locator
- **THEN** the call reverts

### Requirement: Public permissionless reads
The registry SHALL expose read-only functions that:
- return a vault's owner, blob, and version by `vaultId`;
- return several vaults in one call (`getVaults(bytes32[])`);
- return a locator's list length (`locatorLength`);
- return a page of the list (`resolveLocator(locator, start, count)`), with at most 256 entries per page and entries `[start, min(start + count, length))` in insertion order.

Choosing the candidate that decrypts is the client's job (see `vault-crypto`). Reads SHALL need only a standard `eth_call` to any node: no transaction, signature, or CryoShield infrastructure.

#### Scenario: Recovery read via public RPC
- **WHEN** a client pages `resolveLocator` and then calls `getVaults` for each page through a public RPC, using only a locator derived from a hardware key
- **THEN** it receives the exact stored blobs without sending a transaction

#### Scenario: Unknown locator
- **WHEN** a client resolves a locator that was never registered
- **THEN** `locatorLength` returns 0 and every page is an empty list, without reverting

#### Scenario: Page bounds
- **WHEN** `start` is at or beyond the list length, or `count` is 0
- **THEN** the call returns an empty list, and a `count` above 256 is clamped to 256

## ADDED Requirements

### Requirement: Registry versions coexist
VaultRegistry v2 SHALL be a new immutable deployment. VaultRegistry v1 SHALL remain deployed and readable, and is never written to by CryoShield clients after v2 is configured for a chain. Readers (the web app and the recovery tool) SHALL query v2 and then v1 for a locator, and treat candidates from both as one list. Writers SHALL use only v2. On any chain where v1 was never deployed (OP Mainnet), clients SHALL use only v2.

#### Scenario: Old testnet vault still recoverable
- **WHEN** a key whose vault exists only in v1 is used to unlock on a chain configured with both registries
- **THEN** the client finds and opens it from v1

#### Scenario: New vault goes to v2
- **WHEN** a user creates a vault on a chain configured with both registries
- **THEN** the create call targets v2 only

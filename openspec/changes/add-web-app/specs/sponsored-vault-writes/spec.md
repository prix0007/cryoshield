# Spec Delta

## Purpose

Lets users write their vault to the VaultRegistry using only their hardware keys, through an ERC-4337 smart account owned by those keys, with gas paid by CryoShield through a third-party paymaster.

## ADDED Requirements

### Requirement: Key-owned smart account
Each user's vault owner SHALL be an ERC-4337 smart account whose owners are exactly the WebAuthn P-256 public keys of the enrolled hardware keys. Owner index order MUST equal the credential order in the vault blob. No other owner (no CryoShield key, no recovery address) SHALL be added.

#### Scenario: Owners match keys
- **WHEN** a vault is created with keys A and B
- **THEN** the deployed account reports exactly two owners, A's public key at index 0 and B's at index 1, and the registry records the account as the vault owner

### Requirement: Gas-free writes for the user
Create, edit, and add-key writes SHALL be submitted as sponsored user operations, so the user never needs ETH, a wallet, or a seed phrase. Every sponsored operation MUST pass the configured sponsorship-policy ID.

#### Scenario: Zero-balance account writes
- **WHEN** a brand-new account with zero ETH creates a vault
- **THEN** the operation is included on-chain with the paymaster paying gas, and the account balance stays zero

### Requirement: Sponsorship scope
The app SHALL only build sponsored operations whose calls target the VaultRegistry (create, update, add locators) or the account itself (add owner). The sponsorship policy MUST enforce per-account and global spending caps.

#### Scenario: Out-of-scope call refused client-side
- **WHEN** code attempts to build a sponsored operation calling any other address
- **THEN** the app throws before contacting the bundler

#### Scenario: Cap reached
- **WHEN** the paymaster refuses sponsorship because a cap is reached
- **THEN** the user sees "Saving is paused right now, your existing vault is safe; try again later", and no unsponsored fallback is attempted

### Requirement: Create vault in one operation
Vault creation SHALL deploy the account (if undeployed) and call the registry's create function with a fresh random 32-byte vaultId, the encrypted blob, and every key's locator, in a single user operation. If the vaultId is taken, it MUST retry once with a new random vaultId.

#### Scenario: vaultId collision
- **WHEN** the create call reverts because the vaultId already exists
- **THEN** the app re-signs with a new random vaultId, and on second failure reports an error without retrying further

### Requirement: Edit secrets with one key
Editing secrets SHALL replace the vault blob through the registry update call, signed by one enrolled key. The new blob MUST keep the same wrapped-key entries and locators and MUST be produced by `@cryoshield/vault-crypto`.

#### Scenario: Edit then unlock with other key
- **WHEN** a user unlocks with key A, adds a secret, saves, and later unlocks with key B
- **THEN** key B shows the added secret and the vault version has increased by 1

### Requirement: Add a key atomically
Adding a key SHALL, in one user operation, add the new key as an account owner, register its locator, and replace the blob with one that lets the new key unlock. All currently enrolled keys MUST be present, since the vault is re-wrapped for every key. The total MUST NOT exceed 8 keys.

#### Scenario: New key unlocks
- **WHEN** a 2-key vault adds key C and the operation succeeds
- **THEN** key C alone unlocks the vault and the account reports 3 owners

#### Scenario: Partial failure impossible
- **WHEN** any call in the add-key operation reverts
- **THEN** none of its effects persist, and the vault still unlocks with the original keys

### Requirement: Clear write status
Every write SHALL show progress states (waiting for key, saving, confirmed) and SHALL report "Saved" only after the operation receipt shows success and the stored blob read back via public RPC equals the submitted blob.

#### Scenario: Reverted operation
- **WHEN** the user operation is included but the inner call reverts
- **THEN** the app reports that nothing was saved and keeps the user's unsaved edits in memory for retry

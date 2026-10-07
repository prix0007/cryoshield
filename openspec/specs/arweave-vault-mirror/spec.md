# arweave-vault-mirror Specification

## Purpose
Keeps a permanent second copy of every written vault blob on Arweave, tagged so the desktop recovery tool can find it with only a locator, even if the chain or the CryoShield site is gone.

## Requirements

### Requirement: Mirror after every write
After a vault write is confirmed, the app SHALL upload the exact stored blob bytes to Arweave through ArDrive Turbo. A mirror failure MUST NOT undo or block the on-chain write. It MUST be shown to the user as a non-blocking warning with a retry action.

#### Scenario: Mirror succeeds
- **WHEN** a vault create is confirmed on-chain
- **THEN** a data item whose bytes equal the stored blob is uploaded and the UI shows "Backup copy saved"

#### Scenario: Mirror fails
- **WHEN** the Turbo upload errors or is refused
- **THEN** the vault is still reported as saved, a warning "Extra backup copy not saved yet" appears with a Retry button, and no secret data is logged

### Requirement: Discoverable tags
Every mirrored data item SHALL carry exactly the tag schema in `add-desktop-recovery-tool` design.md, decision D5, and no other `CryoShield-*` tags:
- `App-Name: CryoShield`
- `CryoShield-Format: 1`
- `CryoShield-Vault-Id: 0x<64 lowercase hex>`
- `CryoShield-Version: <decimal vault version>`
- one `CryoShield-Locator: 0x<64 lowercase hex>` tag per locator registered for the vault

#### Scenario: Recovery query finds the blob
- **WHEN** an Arweave GraphQL query filters on `App-Name = CryoShield` and `CryoShield-Locator = <locator>`
- **THEN** it returns the mirrored item, and its data is byte-identical to the on-chain blob of that version

#### Scenario: Tag format
- **WHEN** a blob for a vault with 3 locators at version 2 is uploaded
- **THEN** the data item has exactly 7 tags (App-Name, Format, Vault-Id, Version, and 3 Locator tags), all hex values lowercase and 0x-prefixed with 64 hex digits

### Requirement: Mirror stays within the free tier size
Each mirrored data item, blob plus tags, SHALL be well under the Turbo free-tier item size (105 KiB). The app MUST NOT require the user to hold or buy Turbo credits.

#### Scenario: Size check
- **WHEN** a maximum-size (1024-byte) blob with 8 locators is prepared for upload
- **THEN** the signed data item is under 8 KiB

### Requirement: Untrusted mirror content
Data found on Arweave SHALL be treated as untrusted. The app and recovery tooling MUST only accept an item whose blob authenticates through vault-crypto candidate selection. When on-chain data is available, the app MUST prefer the on-chain blob.

#### Scenario: Spoofed tagged item
- **WHEN** a third party uploads junk with a victim's locator tag
- **THEN** the junk fails authentication and is ignored without error

### Requirement: Self-healing mirror on unlock
After a successful unlock, the app SHALL query Arweave GraphQL for items tagged with the current `CryoShield-Vault-Id` and `CryoShield-Version`. If no returned item's data (read with a 1024-byte cap) equals the on-chain blob, the app MUST upload it, with no key tap needed.

#### Scenario: Missed mirror repaired
- **WHEN** a previous save's mirror upload was lost because the tab closed, and the user later unlocks
- **THEN** the app uploads the current blob in the background, and a later GraphQL query finds it

### Requirement: Ephemeral upload identity
The Turbo upload signer SHALL be a random key generated in memory per session. It MUST NOT be derived from any PRF output or hardware key, and MUST NOT be persisted.

#### Scenario: Unlinkable signer
- **WHEN** two uploads happen in two separate sessions for the same vault
- **THEN** they are signed by different addresses, neither derived from key material

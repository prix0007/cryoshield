# Spec Delta

## ADDED Requirements

### Requirement: Vault ID binding
Every blob SHALL be cryptographically bound to the 32-byte `vaultId` under which it is registered. The `vaultId` SHALL NOT be stored in the blob; every reader MUST supply it from where the blob was found (the registry's `vaultId`, or the Arweave `CryoShield-Vault-Id` tag). A `vaultId` MUST be exactly 32 bytes and non-zero; anything else is rejected with `INVALID_ARGUMENT`. Opening a blob under any `vaultId` other than the one it was created for MUST fail with `NO_MATCHING_KEY`, and MUST NOT return plaintext.

#### Scenario: Cloned blob under another vaultId
- **WHEN** a genuine vault blob is copied byte for byte into a different `vaultId`, and opened with an enrolled key and that different `vaultId`
- **THEN** opening fails with `NO_MATCHING_KEY` and no plaintext is returned (verified by the wrong-vaultId vectors for modes 0x01 and 0x02)

#### Scenario: Correct vaultId opens
- **WHEN** a vault is opened with an enrolled key (mode 0x01), or with M enrolled keys (mode 0x02), and the `vaultId` it was created for
- **THEN** the original secret is returned (verified by one positive vector per mode)

#### Scenario: Invalid vaultId rejected
- **WHEN** a caller supplies a `vaultId` that is not 32 bytes, or is all zeros
- **THEN** the operation fails with `INVALID_ARGUMENT`

## MODIFIED Requirements

### Requirement: Envelope encryption of the payload
The payload SHALL be encrypted with a fresh random 256-bit data key using AES-256-GCM with a fresh random 96-bit nonce. The additional authenticated data (AAD) MUST be every blob byte that precedes the payload section, followed by the 32-byte `vaultId`:

```
payloadAad = blob[0 .. payloadNonceOffset) || vaultId
```

This way any change to the header, metadata, or wrapped keys is detected, and so is any move of the blob to another `vaultId`.

#### Scenario: Header tampering detected
- **WHEN** any byte of the header or wrapped-key section is modified and the vault is decrypted with a valid key and the correct `vaultId`
- **THEN** decryption fails with an authentication error and no plaintext is returned

#### Scenario: Tampering with another entry's wrap detected
- **WHEN** entry A's wrapped key is modified, and the vault is opened with key B (whose own entry still unwraps)
- **THEN** payload decryption fails with `AUTH_FAILED`, because the payload AAD covers entry A

### Requirement: Any-of-N unlock mode
In mode 0x01, each enrolled key SHALL wrap the full data key with AES-256-GCM under its wrapping key. Creating a vault MUST require N ≥ 2 enrolled keys, and any single enrolled key MUST be able to decrypt.

Each entry's wrap AAD SHALL bind only the fields that never change for a vault, the vault's `vaultId`, and that entry's own identity:

```
magic || version || suite || mode || u8(rpIdLen) || rpId || wrapSalt || vaultId || u8(entryIndex) || u8(credIdLen) || credId
```

It MUST NOT include the key count N, the threshold M, or any other entry. This means appending an entry never invalidates the existing wraps. The payload AAD (see "Envelope encryption of the payload") still covers every header byte and every entry.

#### Scenario: Wrap AAD excludes the key count
- **WHEN** the vector's wrap AAD for an entry is recomputed from the blob and the vector's `vaultId`
- **THEN** it equals the vector's `wrapAad` bytes, contains the `vaultId`, and contains neither the count N nor the threshold M

#### Scenario: Either key unlocks
- **WHEN** a vault is created with keys A and B and is decrypted using only key B's PRF output and the vault's `vaultId`
- **THEN** the original secret is returned

#### Scenario: Single-key vault refused
- **WHEN** a caller tries to create an any-of-N vault with only one key
- **THEN** creation fails with a "at least 2 keys required" error

### Requirement: Adding a key
In mode 0x01, a key SHALL be added to an existing vault using only one currently enrolled key, the vault's `vaultId`, and the new key:
- the existing key's PRF output unwraps the data key and authenticates the payload under that `vaultId`;
- the new key's entry is appended at index N, wrapping the same data key under the new key's wrapping key (with a fresh random wrap nonce, and a wrap AAD that includes the same `vaultId`);
- N is incremented;
- the payload is re-encrypted under the same data key with a fresh random nonce and the new full-header AAD followed by the `vaultId`.

Existing entries MUST be copied byte for byte. Adding MUST be refused:
- when N would exceed 8 (`TOO_MANY_KEYS`);
- when the credential ID is invalid or already enrolled (`INVALID_ARGUMENT`);
- when the blob would exceed 1024 bytes (`VAULT_TOO_LARGE`);
- in mode 0x02 (`INVALID_ARGUMENT`), because adding a Shamir share needs a re-split.

Removing or rotating keys is out of scope.

#### Scenario: Add a key with one existing key present
- **WHEN** key C is added to a 2-key vault (A, B) using only key A's PRF output, the vault's `vaultId`, and key C's PRF output
- **THEN** the new vault has 3 entries, keys A, B, and C each open it alone under that `vaultId`, and entries A and B are byte-identical to the originals

#### Scenario: Add-key result matches vectors
- **WHEN** the add-key vector is replayed with its fixed nonces and `vaultId`
- **THEN** the produced blob equals the vector's expected blob byte for byte

### Requirement: Updating the payload
A vault's secret SHALL be replaceable using the vault's `vaultId` and any key set that can open it (one key in mode 0x01; M keys in mode 0x02). The new padded secret is encrypted under the same data key with a fresh random payload nonce, with the unchanged header and entries followed by the `vaultId` as AAD. The header and entries are unchanged, and the size cap and padding rules apply unchanged.

#### Scenario: One key edits the secret
- **WHEN** key B updates a 2-key vault's secret under the vault's `vaultId`
- **THEN** keys A and B both open the result under that `vaultId`, and get the new secret

### Requirement: Candidate vault selection
A locator MAY resolve to several candidate vaultIds, because the on-chain index is append-only and anyone can append. The client SHALL pair each candidate blob with the `vaultId` it was read from, and try each pair in order. It SHALL select the first pair that opens completely under that `vaultId` (an unwrap and the payload both authenticate), returning its index and `vaultId`, and ignoring all others. A blob cloned under a different `vaultId` therefore never authenticates and is skipped.

#### Scenario: Squatted locator
- **WHEN** a locator resolves to multiple vaultIds, including attacker-written blobs
- **THEN** the client selects the vault that authenticates and ignores the others without error

#### Scenario: Cloned blob skipped
- **WHEN** a locator resolves to an attacker's `vaultId` holding a byte-identical copy of the victim's blob, listed before the victim's genuine `vaultId`
- **THEN** the client skips the clone and selects the victim's genuine `vaultId`

#### Scenario: No candidate authenticates
- **WHEN** none of the candidate blobs authenticates
- **THEN** the client reports "no matching vault" and returns no plaintext

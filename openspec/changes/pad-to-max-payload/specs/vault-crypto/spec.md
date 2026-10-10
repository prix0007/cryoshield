## MODIFIED Requirements

### Requirement: Length-hiding padding
Before encryption, the payload plaintext SHALL be prefixed with its 2-byte big-endian length and zero-padded to the **maximum padded length for the vault's key set**: `64 × floor((1024 − overhead) / 64)` bytes, which is `maxPayloadBytes + 2`, where `overhead` is the spec §7 overhead computed from the RP ID, the credential-ID lengths, the key count N and the mode. The ciphertext length, and so the blob length `overhead + 64 × floor((1024 − overhead) / 64)`, MUST depend only on that public data and never on the secret's length. Every encoder path (create, update payload, add-key) MUST pad to the maximum for the key set of the blob it writes.

Decoders MUST accept any payload ciphertext of `64k + 16` bytes (k ≥ 1) that fits the 1024-byte cap, including blobs written with the earlier 64-byte-step padding, and MUST NOT require maximum padding. After decryption they MUST reject a length prefix greater than `len(padded) − 2`, or any nonzero pad byte, with `MALFORMED`. The format version stays 0x01. The normative cases are the `lengthHidingCases`, `legacyPaddingCases` and padding open cases in `test-vectors/v1.json`.

#### Scenario: Similar-length secrets look identical
- **WHEN** a 10-byte secret and a 40-byte secret are each stored in a vault with the same key set
- **THEN** both payload ciphertexts have the same length

#### Scenario: Seed phrases of different lengths give identical blob lengths
- **WHEN** a 12-word and a 24-word seed phrase are each stored in a vault with the same key set (each `lengthHidingCases` group in `test-vectors/v1.json`: 2 keys and 3 keys in mode 0x01, and 2-of-3 in mode 0x02)
- **THEN** every blob in the group has the group's `blobLength`, and its padded plaintext is `64 × floor((1024 − overhead) / 64)` bytes

#### Scenario: Blob length is a function of public data only
- **WHEN** vaults are created for any valid RP ID, 2..8 credential IDs of any valid length, either mode, and any two secrets that fit
- **THEN** both blobs have length `overhead + 64 × floor((1024 − overhead) / 64)`, which is at most 1024 and more than 960

#### Scenario: Blobs with the earlier padding still open
- **WHEN** each `legacyPaddingCases` blob (padded in 64-byte steps, byte-identical to the vectors before this change) is opened under its `vaultId` with its key
- **THEN** it opens and yields the expected secret

#### Scenario: Bad padding after decryption
- **WHEN** an authenticated payload has a nonzero pad byte, or a length prefix larger than the padded length minus 2 (open cases `nonzero-pad-byte` and `length-prefix-overrun`)
- **THEN** opening fails with `MALFORMED`

### Requirement: Adding a key
In mode 0x01, a key SHALL be added to an existing vault using only one currently enrolled key, the vault's `vaultId`, and the new key:
- the existing key's PRF output unwraps the data key and authenticates the payload under that `vaultId`;
- the new key's entry is appended at index N, wrapping the same data key under the new key's wrapping key (with a fresh random wrap nonce, and a wrap AAD that includes the same `vaultId`);
- N is incremented;
- the payload is re-padded to the maximum padded length for the N + 1 key set (see Length-hiding padding) and re-encrypted under the same data key with a fresh random nonce and the new full-header AAD followed by the `vaultId`.

Existing entries MUST be copied byte for byte. Adding MUST be refused:
- when N would exceed 8 (`TOO_MANY_KEYS`);
- when the credential ID is invalid or already enrolled (`INVALID_ARGUMENT`);
- when the secret is longer than `maxPayloadBytes` for the N + 1 key set, so the blob would exceed 1024 bytes (`VAULT_TOO_LARGE`);
- in mode 0x02 (`INVALID_ARGUMENT`), because adding a Shamir share needs a re-split.

Removing or rotating keys is out of scope.

#### Scenario: Add a key with one existing key present
- **WHEN** key C is added to a 2-key vault (A, B) using only key A's PRF output, the vault's `vaultId`, and key C's PRF output
- **THEN** the new vault has 3 entries, keys A, B, and C each open it alone under that `vaultId`, and entries A and B are byte-identical to the originals

#### Scenario: Add-key result matches vectors
- **WHEN** the add-key vector is replayed with its fixed nonces and `vaultId`
- **THEN** the produced blob equals the vector's expected blob byte for byte

#### Scenario: Add-key re-pads to the smaller maximum
- **WHEN** key C is added to a 2-key vault, including one written with the earlier 64-byte-step padding (vectors `add-C-with-A` and `add-C-to-legacy`)
- **THEN** the result's padded plaintext is the maximum for the 3-key set, and its length is `expectedBlobLength`

#### Scenario: Secret no longer fits after adding a key
- **WHEN** a key is added to a 2-key vault whose secret is longer than the 3-key maximum (vector `add-oversize`)
- **THEN** adding fails with `VAULT_TOO_LARGE`

### Requirement: Updating the payload
A vault's secret SHALL be replaceable using the vault's `vaultId` and any key set that can open it (one key in mode 0x01; M keys in mode 0x02). The new secret is padded to the maximum padded length for the vault's key set (see Length-hiding padding) and encrypted under the same data key with a fresh random payload nonce, with the unchanged header and entries followed by the `vaultId` as AAD. The header and entries are unchanged, and the size cap applies unchanged.

#### Scenario: One key edits the secret
- **WHEN** key B updates a 2-key vault's secret under the vault's `vaultId`
- **THEN** keys A and B both open the result under that `vaultId`, and get the new secret

#### Scenario: An edit re-pads to the maximum
- **WHEN** a vault is updated, including one written with the earlier 64-byte-step padding (vectors `update-with-B` and `update-legacy-to-max`)
- **THEN** the result has the maximum padded length for its key set, equals the vector's expected blob byte for byte, and its length is `expectedBlobLength`

### Requirement: Deterministic test vectors
The project SHALL publish `test-vectors/v1.json` containing fixed PRF outputs, salts, nonces, data keys, Shamir coefficients, and the expected encoded blobs and derived values for modes 0x01 and 0x02. It SHALL also contain negative cases (tampered byte, wrong key, insufficient shares, oversize, unknown version/suite/mode, truncated, bad padding), each with its named error code. It SHALL contain `lengthHidingCases` (groups of vaults with one key set and secrets of different lengths, including 12-word and 24-word seed phrases, that share one blob length), add-key and update re-pad cases, and `legacyPaddingCases` whose blobs are byte-identical to the blobs published before the maximum-padding rule. Every vector SHALL include the raw CTAP2 salt `ctapSalt` = SHA-256("WebAuthn PRF" || 0x00 || PRF input). Every implementation MUST pass all vectors.

#### Scenario: Library passes vectors
- **WHEN** the library's test suite runs against `test-vectors/v1.json` with injected deterministic randomness
- **THEN** every positive vector reproduces byte-identical output and every negative vector produces its specified error

#### Scenario: Legacy blobs are pinned
- **WHEN** the vector generator runs
- **THEN** it fails unless every `legacyPaddingCases` blob has the SHA-256 recorded for the blob it replaces

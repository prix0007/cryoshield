# Spec Delta

## Purpose

Defines the permanent, versioned CryoShield vault blob format and how keys are derived from FIDO2 PRF outputs, so any compliant implementation can locate, encrypt, and decrypt a vault using only an enrolled hardware key.

## ADDED Requirements

### Requirement: Versioned blob header
Every vault blob SHALL begin with the 4-byte magic `CRYO` (0x43 0x52 0x59 0x4F), followed by a 1-byte format version (0x01 for this spec), a 1-byte suite ID, and a 1-byte unlock mode. Decoders MUST reject blobs with a wrong magic or an unknown version, suite, or mode instead of guessing.

#### Scenario: Valid v1 header
- **WHEN** a blob starting with `CRYO`, version 0x01, suite 0x01, and mode 0x01 is decoded
- **THEN** decoding proceeds to the body fields

#### Scenario: Unknown version rejected
- **WHEN** a blob with version byte 0x02 is decoded by a v1-only decoder
- **THEN** decoding fails with an "unsupported version" error and no decryption is attempted

### Requirement: Algorithm suite 0x01
Suite 0x01 SHALL mean HKDF-SHA256 for key derivation and AES-256-GCM (96-bit nonce, 128-bit tag) for both key wrapping and payload encryption. Suite 0x01 MUST NOT use any public-key or elliptic-curve encryption primitive.

#### Scenario: Suite matches test vectors
- **WHEN** the suite 0x01 test vectors in `test-vectors/v1.json` are processed
- **THEN** every derived key, wrapped key, and ciphertext matches the expected bytes exactly

### Requirement: Blob size cap
An encoded vault blob SHALL NOT exceed 1024 bytes. Encoders MUST refuse to produce a larger blob and report how many payload bytes are available for the chosen key count.

#### Scenario: Oversized secret rejected
- **WHEN** a caller encrypts a payload that would make the blob exceed 1024 bytes
- **THEN** encryption fails with a "vault too large" error stating the maximum payload size

### Requirement: Recorded relying-party and credential metadata
Each blob SHALL record:
- the WebAuthn RP ID (ASCII, 1–64 bytes);
- the per-vault 32-byte wrap salt;
- for each enrolled key, its credential ID (1–128 bytes).

This is so that a recovery tool can reproduce the PRF evaluation without any external service.

#### Scenario: Metadata round-trips
- **WHEN** a vault is encoded and then decoded
- **THEN** the RP ID, wrap salt, and every credential ID are returned byte-identical and in enrollment order

### Requirement: Single PRF input
Every ceremony SHALL evaluate exactly one PRF input: the global salt SHA-256("cryoshield/v1/locator-salt"). Implementations talking CTAP2 `hmac-secret` directly MUST use salt = SHA-256("WebAuthn PRF" || 0x00 || that input), so that browser and desktop recovery produce identical outputs.

#### Scenario: Browser and CTAP outputs agree
- **WHEN** the same credential is evaluated via WebAuthn PRF with the global salt and via CTAP2 hmac-secret with the transformed salt
- **THEN** both return the same 32-byte output (verified by the CTAP-salt fields in the test vectors)

### Requirement: Locator derivation
A key's locator SHALL be HKDF-SHA256(ikm = PRF output, salt = empty, info = "cryoshield/v1/locator", L = 32), used on-chain as a bytes32 lookup key. Each enrolled key has its own locator. The contract, not this format, assigns vaultIds.

#### Scenario: Locator matches vector
- **WHEN** the locator is derived from the vector's fixed PRF output
- **THEN** it equals the vector's expected 32-byte locator

#### Scenario: Each key has its own locator
- **WHEN** a vault is created with two enrolled keys
- **THEN** two distinct locators are produced, one per key

### Requirement: Per-vault wrap salt
A fresh 32-byte wrap salt SHALL be generated with a cryptographically secure RNG for each new vault and stored in the blob header. It is used as the HKDF salt for wrapping keys and is never sent to the authenticator.

#### Scenario: Salts are unique per vault
- **WHEN** two vaults are created with the same hardware keys
- **THEN** their wrap salts differ and their wrapped data keys differ

### Requirement: Wrapping-key derivation
Each enrolled key's wrapping key SHALL be HKDF-SHA256(ikm = PRF output, salt = the vault's wrap salt, info = "cryoshield/v1/wrap", L = 32), derived from the same PRF output as the locator, without another ceremony.

#### Scenario: Wrapping key matches vector
- **WHEN** the wrapping key is derived from the vector's fixed PRF output
- **THEN** it equals the vector's expected wrapping key

### Requirement: Envelope encryption of the payload
The payload SHALL be encrypted with a fresh random 256-bit data key using AES-256-GCM with a fresh random 96-bit nonce. The additional authenticated data (AAD) MUST be every blob byte that precedes the payload section, so that any change to the header, metadata, or wrapped keys is detected.

#### Scenario: Header tampering detected
- **WHEN** any byte of the header or wrapped-key section is modified and the vault is decrypted with a valid key
- **THEN** decryption fails with an authentication error and no plaintext is returned

### Requirement: Length-hiding padding
Before encryption, the payload plaintext SHALL be prefixed with its 2-byte big-endian length and zero-padded to the next multiple of 64 bytes (capped by the blob size limit). This is so the ciphertext length does not reveal the exact secret length.

#### Scenario: Similar-length secrets look identical
- **WHEN** a 10-byte secret and a 40-byte secret are each stored in a vault with the same key count
- **THEN** both payload ciphertexts have the same length

### Requirement: Any-of-N unlock mode
In mode 0x01, each enrolled key SHALL wrap the full data key with AES-256-GCM under its wrapping key. The AAD SHALL be the fixed header (magic through wrap salt) concatenated with that entry's credential ID. Creating a vault MUST require N ≥ 2 enrolled keys, and any single enrolled key MUST be able to decrypt.

#### Scenario: Either key unlocks
- **WHEN** a vault is created with keys A and B and is decrypted using only key B's PRF output
- **THEN** the original secret is returned

#### Scenario: Single-key vault refused
- **WHEN** a caller tries to create an any-of-N vault with only one key
- **THEN** creation fails with a "at least 2 keys required" error

### Requirement: Shamir M-of-N unlock mode
In mode 0x02, the data key SHALL be split into N Shamir shares with threshold M (2 ≤ M ≤ N ≤ 8), using a share encoding fixed by the test vectors. Each enrolled key wraps one share. Decryption MUST succeed with any M shares and MUST fail with fewer.

#### Scenario: Threshold met
- **WHEN** a 2-of-3 vault is decrypted with the PRF outputs of any two enrolled keys
- **THEN** the original secret is returned

#### Scenario: Threshold not met
- **WHEN** the same 2-of-3 vault is decrypted with one key's PRF output
- **THEN** decryption fails with an "insufficient shares" error and no partial data is returned

### Requirement: Wrong key rejection
Decrypting with a PRF output that does not correspond to any enrolled entry SHALL fail with a "no matching key" error and MUST NOT return plaintext or reveal which step failed beyond that error.

#### Scenario: Unenrolled key
- **WHEN** a vault is decrypted with an unenrolled key's PRF output
- **THEN** the "no matching key" error is returned

### Requirement: Single-tap unlock
Creating or unlocking a vault SHALL need exactly one ceremony per key. The client keeps that key's PRF output in memory, derives the locator, fetches the blob, then derives the wrapping key from the blob's wrap salt without touching the authenticator again.

#### Scenario: Recovery without a cached blob
- **WHEN** a user with only a hardware key recovers a vault
- **THEN** one tap yields the PRF output, the blob is fetched by the derived locator, and decryption completes with no second tap

### Requirement: PRF output handling
PRF outputs and every key derived from them SHALL be held only in memory, zeroized (overwritten) as soon as the operation completes or fails, and never persisted to storage, logs, or the network.

#### Scenario: Zeroized after unlock
- **WHEN** an open-vault call returns, either successfully or with an error
- **THEN** the PRF output buffer and the derived wrapping-key buffers passed through the library read as all zeros

### Requirement: Candidate vault selection
A locator MAY resolve to several candidate vaultIds, because the on-chain index is append-only and anyone can append. The client SHALL try each candidate blob and select the one whose AES-GCM unwrap authenticates under the derived wrapping key, ignoring all others.

#### Scenario: Squatted locator
- **WHEN** a locator resolves to multiple vaultIds, including attacker-written blobs
- **THEN** the client selects the vault that authenticates and ignores the others without error

#### Scenario: No candidate authenticates
- **WHEN** none of the candidate blobs authenticates
- **THEN** the client reports "no matching vault" and returns no plaintext

### Requirement: Deterministic test vectors
The project SHALL publish `test-vectors/v1.json` containing fixed PRF outputs, salts, nonces, data keys, Shamir coefficients, and the expected encoded blobs and derived values for modes 0x01 and 0x02. It SHALL also contain negative cases (tampered byte, wrong key, insufficient shares, oversize, unknown version). Every implementation MUST pass all vectors.

#### Scenario: Library passes vectors
- **WHEN** the library's test suite runs against `test-vectors/v1.json` with injected deterministic randomness
- **THEN** every positive vector reproduces byte-identical output and every negative vector produces its specified error

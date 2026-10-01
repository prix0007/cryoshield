# vault-crypto Specification

## Purpose
Defines the permanent, versioned CryoShield vault blob format and how keys are derived from FIDO2 PRF outputs, so any compliant implementation can locate, encrypt, and decrypt a vault using only an enrolled hardware key.

## Requirements

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

### Requirement: Length-hiding padding
Before encryption, the payload plaintext SHALL be prefixed with its 2-byte big-endian length and zero-padded to the next multiple of 64 bytes (capped by the blob size limit). This is so the ciphertext length does not reveal the exact secret length.

#### Scenario: Similar-length secrets look identical
- **WHEN** a 10-byte secret and a 40-byte secret are each stored in a vault with the same key count
- **THEN** both payload ciphertexts have the same length

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

### Requirement: Shamir M-of-N unlock mode
In mode 0x02, the data key SHALL be split into N Shamir shares with threshold M (2 ≤ M ≤ N ≤ 8), and each enrolled key wraps one share. Decryption MUST succeed with any M shares and MUST fail with fewer.

The sharing is fixed as follows, matching `shamir-secret-sharing` 0.0.4:
- **Field:** GF(2^8) with reduction polynomial x⁸ + x⁴ + x³ + x + 1 (0x11B), the AES/Rijndael field. Addition is XOR.
- **Polynomials:** each byte of the data key is split independently with its own polynomial of degree M−1. The constant term is the secret byte, and the other coefficients are uniformly random bytes (zero allowed).
- **x-coordinates:** distinct values in 1..255, one per share, public.
- **Wrapped share plaintext (33 bytes):** the x-coordinate (1 byte) first, then the 32 y-bytes, in data-key byte order. Note that the library's native order is `y || x`.
- **Reconstruction:** Lagrange interpolation at x = 0. The reconstructed data key is authenticated only by payload decryption.

Mode 0x02 is experimental and not part of the default MVP flow.

#### Scenario: Share encoding matches vectors
- **WHEN** the mode 0x02 vector's data key is split with the vector's `shamirRng` stream
- **THEN** every share equals the vector's expected `x || y` bytes, and each wrapped share matches byte for byte

#### Scenario: Threshold met
- **WHEN** a 2-of-3 vault is decrypted with the PRF outputs of any two enrolled keys
- **THEN** the original secret is returned

#### Scenario: Threshold not met
- **WHEN** the same 2-of-3 vault is decrypted with one key's PRF output
- **THEN** decryption fails with an "insufficient shares" error and no partial data is returned

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

### Requirement: Wrong key rejection
Decrypting with a PRF output that does not correspond to any enrolled entry SHALL fail with a "no matching key" error and MUST NOT return plaintext or reveal which step failed beyond that error.

#### Scenario: Unenrolled key
- **WHEN** a vault is decrypted with an unenrolled key's PRF output
- **THEN** the "no matching key" error is returned

### Requirement: User verification required
Every WebAuthn ceremony that evaluates the PRF SHALL request user verification as "required":
- for `navigator.credentials.create()`, in `authenticatorSelection` (`userVerification: "required"`, `residentKey: "required"`), because `create()` ignores a top-level `userVerification`;
- for `navigator.credentials.get()`, with a top-level `userVerification: "required"`.

Before using any PRF output from `create()` or `get()`, the client SHALL verify that the UV flag (bit 2 of the flags byte at offset 32 of `authenticatorData`) is set. If it is not, the client SHALL discard the output and fail with `USER_NOT_VERIFIED`.

Every CTAP2 `hmac-secret` evaluation MUST be made with user verification (a PIN or built-in UV), so that the authenticator uses its UV-bound `CredRandomWithUV`.

The reason: CTAP2 authenticators hold two independent secrets per credential, `CredRandomWithUV` and `CredRandomWithoutUV`, and the UV state of the ceremony picks which one is used. A browser using `"preferred"` or `"discouraged"` can therefore get a different PRF output than the recovery tool, and derive keys that can never be reproduced. The library exports separate create and get option fragments with this setting fixed, and an `assertUserVerified` check.

#### Scenario: Browser and desktop derive the same keys
- **WHEN** a vault is created in the browser with `userVerification: "required"`, and later recovered by the desktop tool using `hmac-secret` with PIN/UV
- **THEN** both evaluations return the same PRF output, and the derived locator and wrapping key match

#### Scenario: UV setting fixed in the create and get options
- **WHEN** a client builds its options with the library's create and get helpers
- **THEN** the create options have `authenticatorSelection.userVerification: "required"` and `residentKey: "required"`, the get options have a top-level `userVerification: "required"`, and both have the global locator salt as the only PRF input

#### Scenario: PRF output without UV rejected
- **WHEN** a create or get response's `authenticatorData` has the UV flag clear (for example, flags 0x01, user presence only)
- **THEN** the UV check fails with `USER_NOT_VERIFIED` and the PRF output is not used (verified by the `authenticatorDataCases` vectors)

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

### Requirement: Named error codes
Each failure SHALL be reported with one of these stable error codes, which the test vectors use and every implementation MUST reproduce:
- `BAD_MAGIC`, `UNSUPPORTED_VERSION`, `UNSUPPORTED_SUITE`, `UNSUPPORTED_MODE`, `MALFORMED`: decoding;
- `VAULT_TOO_LARGE`, `TOO_FEW_KEYS`, `TOO_MANY_KEYS`, `INVALID_ARGUMENT`: creation;
- `NO_MATCHING_KEY`, `INSUFFICIENT_SHARES`, `AUTH_FAILED`: opening;
- `NO_MATCHING_VAULT`: candidate selection;
- `USER_NOT_VERIFIED`: the user-verification check on `authenticatorData`.

Authentication failures MUST surface only as these codes: `NO_MATCHING_KEY` when no entry unwraps, and `AUTH_FAILED` when the payload does not authenticate. They MUST carry no further detail.

#### Scenario: Error codes match vectors
- **WHEN** each negative vector in `test-vectors/v1.json` is processed
- **THEN** the implementation fails with exactly the vector's `expectedError` code

### Requirement: Deterministic test vectors
The project SHALL publish `test-vectors/v1.json` containing fixed PRF outputs, salts, nonces, data keys, Shamir coefficients, and the expected encoded blobs and derived values for modes 0x01 and 0x02. It SHALL also contain negative cases (tampered byte, wrong key, insufficient shares, oversize, unknown version/suite/mode, truncated), each with its named error code. Every vector SHALL include the raw CTAP2 salt `ctapSalt` = SHA-256("WebAuthn PRF" || 0x00 || PRF input). Every implementation MUST pass all vectors.

#### Scenario: Library passes vectors
- **WHEN** the library's test suite runs against `test-vectors/v1.json` with injected deterministic randomness
- **THEN** every positive vector reproduces byte-identical output and every negative vector produces its specified error

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

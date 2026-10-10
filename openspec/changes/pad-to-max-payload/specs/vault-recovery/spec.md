## MODIFIED Requirements

### Requirement: Format v1 conformance
The tool SHALL implement vault format v1 decoding, locator and wrap-key derivation, unwrapping, and payload decryption for modes 0x01 and 0x02, as specified by `vault-crypto`. It MUST pass every positive and negative case in `packages/vault-crypto/test-vectors/v1.json`, including the `lengthHidingCases` and `legacyPaddingCases` sections. It MUST open blobs whose payload is padded to the maximum for their key set and blobs padded in the earlier 64-byte steps, and MUST NOT require either. A disagreement with the vectors MUST be reported, never patched over.

#### Scenario: All vectors pass
- **WHEN** the test suite runs against `v1.json`
- **THEN** every positive vector reproduces the expected locator, wrap key, and plaintext, and every negative vector yields its specified error class

#### Scenario: Vector file missing or changed
- **WHEN** `v1.json` is absent or its recorded SHA-256 differs from the pinned value in the tool's tests
- **THEN** the test suite fails, rather than skipping, until the pin is consciously updated

#### Scenario: Both paddings open
- **WHEN** the tool opens a `legacyPaddingCases` blob and a maximum-padded blob from the `vaults` section
- **THEN** both yield their expected secrets

# Spec Delta

## Purpose
Defines how CryoShield proves, on-chain and without any backend, that an account owner's P-256 key lives in a genuine hardware security key. The proof is a WebAuthn packed attestation that chains to pinned vendor roots. The result is a public record that the sponsorship paymaster reads.

## ADDED Requirements

### Requirement: Packed attestation verification
The `AttestationRegistry` SHALL accept a WebAuthn registration's `attestationObject` and `clientDataHash` and verify, entirely on-chain:
- the format is `packed` with `alg = -7` (ES256) and a non-empty `x5c`;
- the authenticator data has the AT flag set and `rpIdHash = sha256("cryoshield.app")`;
- the credential public key is a COSE EC2 P-256 key `(x, y)`;
- the credProtect extension output is level 3 (`userVerificationRequired`);
- `sig` is a valid P-256 signature by the leaf certificate's key over `authenticatorData ‖ clientDataHash`;
- the leaf certificate has OU "Authenticator Attestation", basic constraints CA=false, and the FIDO AAGUID extension (`1.3.6.1.4.1.45724.1.1.4`) equal to the authenticator data's AAGUID;
- the leaf is signed (sha256WithRSAEncryption, PKCS#1 v1.5) by a pinned trust anchor.

Verification SHALL be tested against the fixtures in `contracts/test/fixtures/attestation/`. These are real YubiKey 5 packed attestations (public data) for firmware chaining to "Yubico U2F Root CA Serial 457200631" and to "Yubico FIDO Root CA Serial 450203556", plus synthetic chains under a test root, one per rejection reason.

#### Scenario: Real YubiKey attestation accepted
- **WHEN** a fixture attestation from a YubiKey 5 under a pinned Yubico intermediate is verified
- **THEN** verification succeeds and returns the credential key `(x, y)`, the AAGUID, and the leaf certificate hash

#### Scenario: Self-signed or anonymized attestation refused
- **WHEN** the attestation is `fmt: "none"`, self attestation (no `x5c`), or a leaf not signed by a pinned anchor (for example, Chrome's replacement certificate after the user declines)
- **THEN** verification fails

#### Scenario: Wrong RP or missing credProtect
- **WHEN** the authenticator data's rpIdHash is for another RP, or the credProtect output is absent or below 3
- **THEN** verification fails

#### Scenario: Tampered signature or AAGUID mismatch
- **WHEN** any byte of `authenticatorData`, `clientDataHash` or `sig` is changed, or the certificate's AAGUID extension differs from the authenticator data's AAGUID
- **THEN** verification fails

### Requirement: Binding to an account owner
An attestation SHALL be recorded for an account only when its credential key `(x, y)` is an owner of that account. For a deployed account, the account reports it through `isOwnerPublicKey(x, y)`. For a not-yet-deployed account, the key must be among `owners` with `factory.getAddress(owners, nonce) == account` for the pinned CBSW v1.1 factory.

#### Scenario: Someone else's public attestation reused
- **WHEN** a caller submits a genuine attestation (copied from public calldata) for an account that does not own that key
- **THEN** the call reverts and nothing is recorded

#### Scenario: Counterfactual account
- **WHEN** `attest` is called inside the account's first user operation, after deployment by `initCode` and with the key among its owners
- **THEN** the key is recorded as attested for that account

### Requirement: Recorded attestation state
On success, the registry SHALL record `attestedKey[keccak256(x, y)]` (with the AAGUID and leaf hash) and emit `KeyAttested(account, keyHash, aaguid, leafHash)`. The registry SHALL mark the account attested once every current owner key is attested. It SHALL store no certificate, credential ID or PRF-related data. A read-only `verify` SHALL perform the same checks without writing, for use in paymaster validation.

#### Scenario: Both keys attested
- **WHEN** an account with two owner keys has `attest` called with valid attestations for both
- **THEN** `isAttested(account)` returns true and both `isKeyAttested` lookups return true

#### Scenario: Verify has no side effects
- **WHEN** `verify` is called with valid inputs
- **THEN** it returns success and no storage changes

### Requirement: Trust anchors and revocation
The registry SHALL be deployed with pinned trust anchors: the Yubico FIDO attestation intermediates and roots that are current at deployment. Its owner SHALL be able only to add a trust anchor, and to denylist a trust anchor, a leaf certificate hash or an AAGUID (for example, after a FIDO MDS `ATTESTATION_KEY_COMPROMISE` report). A denylisted item SHALL make new verifications fail, and SHALL make `isAttested`/`isKeyAttested` return false for keys recorded under it. The owner SHALL NOT be able to mark a key attested without a valid attestation, and SHALL NOT be able to affect any vault.

#### Scenario: Compromised batch denylisted
- **WHEN** the owner denylists a leaf certificate hash
- **THEN** previously attested keys under that leaf stop counting as attested, and new attestations under it fail

#### Scenario: No owner backdoor
- **WHEN** any caller, including the owner, tries to record a key without a valid attestation
- **THEN** the call reverts

### Requirement: Bounded verification cost
One attestation verification SHALL cost at most 400,000 gas in `verify`, measured on the fixtures and recorded in `contracts/GAS.md`, so that two verifications fit in a sponsored first operation's verification gas.

#### Scenario: Gas snapshot
- **WHEN** the gas test verifies each real fixture
- **THEN** each verification uses at most 400,000 gas and the snapshot check passes

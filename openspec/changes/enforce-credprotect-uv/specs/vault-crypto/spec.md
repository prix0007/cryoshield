# Spec Delta

## MODIFIED Requirements

### Requirement: User verification required
Every WebAuthn ceremony that evaluates the PRF SHALL request user verification as "required":
- for `navigator.credentials.create()`, in `authenticatorSelection` (`userVerification: "required"`, `residentKey: "required"`), because `create()` ignores a top-level `userVerification`;
- for `navigator.credentials.get()`, with a top-level `userVerification: "required"`.

Before using any PRF output from `create()` or `get()`, the client SHALL verify that the UV flag (bit 2 of the flags byte at offset 32 of `authenticatorData`) is set. If it is not, the client SHALL discard the output and fail with `USER_NOT_VERIFIED`.

Every CTAP2 `hmac-secret` evaluation MUST be made with user verification (a PIN or built-in UV), so that the authenticator uses its UV-bound `CredRandomWithUV`.

UV SHALL also be enforced by the authenticator. The create options SHALL request CTAP 2.1 credProtect level 3 (`credentialProtectionPolicy: "userVerificationRequired"` with `enforceCredentialProtectionPolicy: true`). Before a new credential is used for a vault, the client SHALL confirm level 3 from the `credProtect` extension output in the registration `authenticatorData`. A missing, lower or unparsable level SHALL fail with `CRED_PROTECT_UNSUPPORTED`, and the key MUST NOT be enrolled. The reason: credential IDs are public in the blob, and the smart wallet does not itself require UV or check rpId and origin, so only a key that refuses every assertion without UV stops a stolen key from signing.

The reason for requiring UV at all: CTAP2 authenticators hold two independent secrets per credential, `CredRandomWithUV` and `CredRandomWithoutUV`, and the UV state of the ceremony picks which one is used. A browser using `"preferred"` or `"discouraged"` can therefore get a different PRF output than the recovery tool, and derive keys that can never be reproduced. The library exports separate create and get option fragments with this setting fixed, an `assertUserVerified` check, and an `assertCredProtectUvRequired` check.

#### Scenario: Browser and desktop derive the same keys
- **WHEN** a vault is created in the browser with `userVerification: "required"`, and later recovered by the desktop tool using `hmac-secret` with PIN/UV
- **THEN** both evaluations return the same PRF output, and the derived locator and wrapping key match

#### Scenario: UV setting fixed in the create and get options
- **WHEN** a client builds its options with the library's create and get helpers
- **THEN** the create options have `authenticatorSelection.userVerification: "required"` and `residentKey: "required"`, the get options have a top-level `userVerification: "required"`, and both have the global locator salt as the only PRF input

#### Scenario: PRF output without UV rejected
- **WHEN** a create or get response's `authenticatorData` has the UV flag clear (for example, flags 0x01, user presence only)
- **THEN** the UV check fails with `USER_NOT_VERIFIED` and the PRF output is not used (verified by the `authenticatorDataCases` vectors)

#### Scenario: credProtect level 3 requested with enforcement
- **WHEN** a client builds its create options with the library's helper
- **THEN** the extensions contain `credentialProtectionPolicy: "userVerificationRequired"` and `enforceCredentialProtectionPolicy: true` next to the PRF input

#### Scenario: Key without credProtect level 3 refused
- **WHEN** a registration `authenticatorData` reports credProtect 1 or 2, reports none (ED flag clear or no `credProtect` entry), or cannot be parsed exactly
- **THEN** `assertCredProtectUvRequired` fails with `CRED_PROTECT_UNSUPPORTED` and the credential is not used for a vault

#### Scenario: Recovery tool unaffected
- **WHEN** the desktop tool evaluates `hmac-secret` with PIN/UV on a credProtect-3 credential
- **THEN** the authenticator returns the assertion and the same PRF output as before

### Requirement: Named error codes
Each failure SHALL be reported with one of these stable error codes, which the test vectors use and every implementation MUST reproduce:
- `BAD_MAGIC`, `UNSUPPORTED_VERSION`, `UNSUPPORTED_SUITE`, `UNSUPPORTED_MODE`, `MALFORMED`: decoding;
- `VAULT_TOO_LARGE`, `TOO_FEW_KEYS`, `TOO_MANY_KEYS`, `INVALID_ARGUMENT`: creation;
- `NO_MATCHING_KEY`, `INSUFFICIENT_SHARES`, `AUTH_FAILED`: opening;
- `NO_MATCHING_VAULT`: candidate selection;
- `USER_NOT_VERIFIED`: the user-verification check on `authenticatorData`;
- `CRED_PROTECT_UNSUPPORTED`: the credProtect level 3 check on a registration's `authenticatorData`.

Authentication failures MUST surface only as these codes: `NO_MATCHING_KEY` when no entry unwraps, and `AUTH_FAILED` when the payload does not authenticate. They MUST carry no further detail.

#### Scenario: Error codes match vectors
- **WHEN** each negative vector in `test-vectors/v1.json` is processed
- **THEN** the implementation fails with exactly the vector's `expectedError` code

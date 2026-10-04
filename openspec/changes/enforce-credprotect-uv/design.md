# Design

## Context

- **Wallet verification:** the smart wallet's WebAuthn verification is `WebAuthn.verify(..., requireUV: false)`, and
  it doesn't bind `rpIdHash` or origin.
- **Public credential IDs:** they are stored in the vault blob.
- **CTAP 2.1 credProtect** (§12.1):
  - level 1: UV optional;
  - level 2: UV optional only when the credential ID is supplied;
  - level 3: UV required. Without UV the authenticator behaves as if the credential doesn't exist, for discoverable and
    allow-listed requests alike.

  Because the credential ID is public, only level 3 closes the hole.

## Decisions

### D1. Request level 3 with enforcement, in the shared option fragment
`webauthnPrfCreateOptions().extensions` gains `credentialProtectionPolicy: "userVerificationRequired"` and
`enforceCredentialProtectionPolicy: true`. With enforcement, a conforming browser fails `create()` when the key can't
satisfy the policy, instead of creating a weaker credential.

### D2. Confirm from the authenticator data, not the browser
WebAuthn defines no client output for credProtect, and Chrome returns none. The authenticator's output is the
`credProtect` integer in the CBOR extensions map of the registration `authenticatorData` (ED flag 0x80, after the
attested credential data).
- **Parser:** `credProtectLevel()` uses a small, bounded, definite-length CBOR reader.
  - It skips the COSE key and requires the extensions map to end the buffer exactly.
  - It treats any anomaly as "not confirmed": truncation, indefinite lengths, tags, duplicate keys, trailing bytes or
    a non-integer value.
- **Check:** `assertCredProtectUvRequired()` requires exactly 3.
- **Placement:** the web `enrollKey` runs it right after `assertUserVerified`, before the PRF output or the key is
  used. A failure wipes the PRF copy.

This also catches a browser that ignores the extension and a key that downgrades the level.

### D3. Error and wording
- **Errors:** vault-crypto `CRED_PROTECT_UNSUPPORTED` maps to web `KeyError('CRED_PROTECT_UNSUPPORTED')`, shown as
  "Key not supported" with a plain-language explanation.
- **Enrollment cancels:** `NotAllowedError` during enrollment becomes `KeyError('CANCELLED', 'enroll')`. Its message
  mentions both "cancelled" and "this key can't always ask for its PIN", because an enforcing browser uses that error
  for both.

### D4. Signing assertions
`prfCapturingGetFn` already runs `assertUserVerified` on every signing assertion before returning it to viem, so an
assertion without UV never reaches the bundler. New tests pin this with a faulty key that answers without UV.

### D5. E2E fallback
Chrome's CDP virtual authenticator doesn't implement credProtect. We probed it with `ctap2_0` and `ctap2_1`: there is
no ED flag, and an enforced request always fails with `NotAllowedError`.
- **Default shim:** the E2E key fixture installs a test-only shim. It records each `create()` request's extensions,
  forwards the request without the credProtect fields, and appends `{"credProtect": 3}` with the ED flag to the
  returned authenticator data, as a CTAP 2.1 key would.
- **Real-browser test:** `13-credprotect.spec.ts` runs with the shim off and proves that the real browser refuses the
  enforced request, the app refuses the key, and no credential is created. A second test asserts that every
  enrollment asked for level 3 with enforcement.
- **Unit fake:** the fake authenticator is credProtect-aware. It honours the policy, reports the level, emulates the
  enforce failure, and hides level-3 credentials without UV.

## Threat / residual risk

- **AA-H1 closed for new keys.** A stolen key without its PIN returns no assertion for a vault credential, so it can't
  sign a user operation, add an owner or overwrite the vault.
- **Existing credentials** keep the level they were created with. Keys enrolled before this change must be
  re-created. The only such vault is the founder's test vault. It isn't migrated automatically: a key's credProtect
  level can't be changed after creation.
- **Trust in the authenticator:** the protection now rests on the authenticator honouring credProtect.
  - A **contract-level fix** is planned before mainnet: a validator that requires the UV flag and checks `rpIdHash` and
    origin.
  - Until then, a faulty or malicious key could still sign without UV.
- **Browsers that drop the extension** (or don't enforce it) produce credentials we refuse at enrollment. This is fail
  closed: users must enrol in a browser that passes credProtect through, such as current Chrome or Edge.
- **Recovery tool:** unaffected. CTAP2 `getAssertion` with `hmac-secret` and PIN/UV works for level 3, and the tool
  always does UV.

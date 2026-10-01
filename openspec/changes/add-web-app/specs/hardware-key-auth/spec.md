# Spec Delta

## Purpose

Defines how the CryoShield web app talks to FIDO2 hardware keys through WebAuthn: enrolling keys that support PRF, and evaluating the vault PRF input in a way the desktop recovery tool can reproduce exactly.

## ADDED Requirements

### Requirement: Configured relying party
Every WebAuthn ceremony SHALL use the RP ID from the app's build configuration. The app MUST refuse to start a ceremony when the configured RP ID is missing or is not the current origin's host or a registrable suffix of it, and MUST show a plain-language configuration error instead.

#### Scenario: Origin mismatch
- **WHEN** the app is served from a host that does not match the configured RP ID
- **THEN** create and unlock actions are disabled and a message says the site is misconfigured, and no WebAuthn call is made

### Requirement: PRF support detection
Before enrollment, the app SHALL check whether the browser supports the WebAuthn PRF extension. After each credential is created, it SHALL confirm that PRF is enabled for that credential. If either check fails, enrollment of that key MUST stop with a plain-language message naming the likely cause: browser not supported, or key too old (YubiKey firmware older than 5.2).

#### Scenario: Browser without PRF
- **WHEN** the browser reports no PRF support
- **THEN** the create-vault flow shows "This browser can't use security keys for encryption" with a list of supported browsers, and no credential is created

#### Scenario: Key without PRF
- **WHEN** a credential is created but the client extension results report PRF not enabled
- **THEN** that key is not enrolled, the user is told the key is too old or unsupported, and is asked to try a different key

### Requirement: Discoverable credentials
Enrollment SHALL create discoverable (resident) credentials, so that unlock works with no stored credential list and no account name.

#### Scenario: Unlock with empty browser
- **WHEN** a user opens the app in a fresh browser profile with no site data and taps an enrolled key
- **THEN** the ceremony succeeds without the app supplying any credential ID

### Requirement: Fixed user-verification policy
Every ceremony that evaluates PRF SHALL request user verification as "required" and SHALL reject any result whose authenticator data lacks the UV flag. This keeps the hmac-secret output identical across browsers and the desktop recovery tool, which MUST also use UV.

#### Scenario: UV missing
- **WHEN** an assertion returns without the UV flag set
- **THEN** the PRF output is discarded (zeroized) and the user is asked to retry with their key PIN

### Requirement: Single PRF input per ceremony
Every PRF ceremony SHALL evaluate exactly one input: the `vault-crypto` global locator salt (see vault-crypto "Single PRF input"). The app MUST NOT send any other PRF input. Results MUST match the vault-crypto test vectors when fed the vectors' fixed PRF outputs.

#### Scenario: Correct salt sent
- **WHEN** an unlock ceremony is started
- **THEN** the request's PRF `eval.first` equals the locator salt from `test-vectors/v1.json`, and no `eval.second` or `evalByCredential` is present

### Requirement: Minimum two keys at enrollment
Vault creation SHALL require at least 2 and at most 8 enrolled keys, each a distinct credential. The app MUST detect the same physical key being enrolled twice.

#### Scenario: Same key twice
- **WHEN** the user taps the first key again when asked for the second key
- **THEN** the authenticator refuses because of the excluded credential, or the app sees a duplicate credential ID, and the user is asked to use a different key

#### Scenario: Only one key
- **WHEN** the user tries to finish setup with one key
- **THEN** the finish button stays disabled with the text "Add a second key so you're never locked out"

### Requirement: Single-tap unlock ceremony
Unlocking SHALL need exactly one WebAuthn ceremony. That ceremony MUST yield the PRF output used both to derive the locator and to unwrap the vault. Reading the vault MUST NOT need a smart account, a signature, or a transaction.

#### Scenario: One tap opens the vault
- **WHEN** a user with an existing vault taps one enrolled key on the unlock screen
- **THEN** the secrets are shown, and the virtual authenticator records exactly one assertion

### Requirement: PRF output lifetime
PRF outputs SHALL be kept only in memory. They MUST be zeroized right after their derivations finish, and MUST never be written to any web storage, IndexedDB, cookies, logs, or the network.

#### Scenario: No persistence
- **WHEN** a vault is created and then unlocked
- **THEN** localStorage, sessionStorage, IndexedDB, and cookies for the origin hold no PRF output, key, or secret, and no request body contains them

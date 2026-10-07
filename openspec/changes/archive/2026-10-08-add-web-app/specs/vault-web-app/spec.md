# Spec Delta

## Purpose

Defines the CryoShield web app as a static, serverless site: its plain-language flows for creating, unlocking, and editing a vault, the encoding of secrets inside the vault payload, and the privacy, accessibility, and security guarantees it gives users.

## ADDED Requirements

### Requirement: Static deployment with no CryoShield server
The app SHALL build to static files only and SHALL make network requests only to these configured endpoints:
- the chain RPC;
- the bundler/paymaster API;
- the Turbo upload API;
- the Arweave gateway.

It MUST work when served from any static host that is reachable under the configured RP ID.

#### Scenario: Network allowlist
- **WHEN** the E2E suite runs every flow with request interception enabled
- **THEN** every outgoing request targets one of the four configured origins or the app's own origin

### Requirement: Configuration via environment
Every endpoint and identifier SHALL come from `VITE_*` build variables documented in `.env.example`: chain ID, RPC URL, bundler/paymaster URL, sponsorship-policy ID, Turbo upload URL, Arweave gateway URL, RP ID, and RP name. A missing required variable MUST fail the build.

#### Scenario: Missing variable
- **WHEN** the app is built without `VITE_RP_ID`
- **THEN** the build fails with a message naming the variable

### Requirement: Registry deployment from contract output
The registry address and deployment block SHALL be read at build time from `contracts/deployments/<chainId>.json` (`{address, deployBlock, txHash, abiHash}`) for the configured chain ID, and never hardcoded. The build MUST fail if that file is missing, or if its `abiHash` does not match the ABI the app is compiled against.

#### Scenario: ABI drift
- **WHEN** the deployment file's `abiHash` differs from the hash of the bundled VaultRegistry ABI
- **THEN** the build fails with a message naming both hashes

#### Scenario: Unknown chain
- **WHEN** `VITE_CHAIN_ID` names a chain with no deployment file
- **THEN** the build fails with a message naming the expected path

### Requirement: Vault payload encoding v1
The decrypted payload SHALL be UTF-8 JSON `{"v":1,"items":[{"l":<label>,"s":<secret>}...]}` with no other fields. Labels are 0–64 characters; there is at least one item. Decoders MUST reject an unknown `v`. The encoding SHALL be published in `apps/web/docs/payload-v1.md` with fixed examples, so the recovery tool can reproduce it.

#### Scenario: Round-trip
- **WHEN** items "Bitcoin seed" and "GitHub recovery codes" are saved and then unlocked
- **THEN** the same labels and secrets are shown in the same order

#### Scenario: Unknown payload version
- **WHEN** a decrypted payload has `"v":2`
- **THEN** the app shows "This vault was made by a newer version of CryoShield" and displays nothing

### Requirement: Capacity feedback
While the user edits secrets, the app SHALL show the space remaining, computed from `vault-crypto` `maxPayloadBytes` for the current keys. It MUST block saving when the encoded payload does not fit.

#### Scenario: Too much text
- **WHEN** the encoded payload would exceed the available bytes
- **THEN** the Save button is disabled and a message says how many characters to remove

### Requirement: Create-vault flow
The create flow SHALL guide the user through:
1. a short explanation;
2. enrolling key 1 and key 2 (with an option for more);
3. entering secrets;
4. saving;
5. a confirmation that tells them to store the keys in separate places.

Every step MUST use plain language without the words wallet, gas, seed phrase (except as a secret label example), smart account, or transaction.

#### Scenario: Happy path
- **WHEN** a user completes the flow with two keys and one secret
- **THEN** the vault is stored on-chain, unlockable with either key, and the final screen tells them to keep the keys apart

#### Scenario: Jargon check
- **WHEN** the default-flow UI strings are scanned
- **THEN** none contain "gas", "wallet", "transaction", "smart account", "bundler", "paymaster", or "ETH"

### Requirement: Unlock and view flow
The unlock flow SHALL be one button and one key tap. It then lists secrets with their labels, each hidden until the user chooses Show, with a Copy action. If no vault matches the key, the app MUST say so plainly and offer to create a vault.

#### Scenario: No vault for this key
- **WHEN** an enrolled-elsewhere or new key is tapped and no candidate authenticates
- **THEN** the app shows "We couldn't find a vault for this key" with a "Create a vault" action

### Requirement: Add-key flow
After unlocking, the user SHALL be able to add another key (up to 8 total) using ONE current key and the new key. Whenever the user must swap physical keys, the flow MUST wait for an explicit Continue before starting the next ceremony, and MUST name which key to touch.

#### Scenario: Add a third key
- **WHEN** a user with keys A and B adds key C, touching A, then C after Continue, then A after Continue
- **THEN** the vault saves and can be unlocked by C alone

#### Scenario: Vault already has 8 keys
- **WHEN** a user opens Add a key on an 8-key vault
- **THEN** the app says the maximum is reached and offers no add action

### Requirement: Secrets in memory only with auto-lock
Decrypted secrets SHALL exist only in component memory. They MUST be cleared on the Lock action, after 5 minutes without user interaction, and on page hide or unload. The app MUST NOT persist any vault data, secret, label, or key material to browser storage.

#### Scenario: Idle auto-lock
- **WHEN** an unlocked vault sees no interaction for 5 minutes
- **THEN** the secrets view is removed from the DOM and the unlock screen is shown

#### Scenario: Storage stays empty
- **WHEN** any flow completes
- **THEN** localStorage, sessionStorage, IndexedDB, Cache Storage, and cookies contain no vault-related data

### Requirement: Vault details export
After unlocking, the user SHALL be able to view the vault ID and download the current encrypted blob as a file, with an explanation that the file is useless without an enrolled key. The download MUST contain only the on-chain ciphertext blob, byte-identical, and no plaintext.

#### Scenario: Download blob
- **WHEN** a user chooses "Download encrypted backup file"
- **THEN** a file named `cryoshield-<vaultId prefix>.cryo` is saved whose bytes equal the on-chain blob

### Requirement: Clipboard hygiene
Copying a secret SHALL put it on the clipboard and tell the user it will be cleared. The app MUST attempt to overwrite the clipboard after 30 seconds when the page still has focus.

#### Scenario: Copy then clear
- **WHEN** a user copies a secret and keeps the tab focused for 30 seconds
- **THEN** the clipboard no longer contains the secret

### Requirement: Strict content security policy
The served pages SHALL enforce a CSP with:
- `default-src 'none'`, scripts and styles only from `'self'`, and no `'unsafe-inline'` or `'unsafe-eval'`;
- `connect-src` limited to the configured endpoints;
- `frame-ancestors 'none'`, `base-uri 'none'`, and `form-action 'none'`;
- Trusted Types required for scripts.

The page MUST load no third-party scripts, fonts, or analytics.

#### Scenario: CSP blocks injection
- **WHEN** the E2E suite attempts to inject an inline script into the running page
- **THEN** the browser blocks it and reports a CSP violation, and the app keeps working

### Requirement: Accessibility WCAG 2.2 AA
Every flow SHALL meet WCAG 2.2 AA:
- keyboard-only operation and visible focus;
- 24×24 px minimum targets;
- labelled controls;
- status messages announced through live regions;
- no time limits except auto-lock, which warns 30 seconds ahead and can be extended.

#### Scenario: Automated audit
- **WHEN** axe-core runs on every screen of every flow in E2E
- **THEN** it reports zero WCAG 2.2 A/AA violations

#### Scenario: Keyboard-only create
- **WHEN** a user completes the create flow using only the keyboard
- **THEN** every step is reachable and focus moves to each new step's heading

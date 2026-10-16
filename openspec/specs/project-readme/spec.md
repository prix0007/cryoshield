# project-readme Specification

## Purpose
What the repository README must say about the live status, the RP ID binding, the remaining dependencies and the
recovery drill, and how that text is kept tied to the recovery tool.

## Requirements

### Requirement: Current status line
The README SHALL state the network and site the project is live on, the version and date it went live, where the
testnet preview is served, and where the audit status is explained. After the OP Mainnet launch it SHALL NOT describe
the project as testnet-only.

#### Scenario: Launched project
- **WHEN** the README test reads the README after the `v1.0.0` launch
- **THEN** it finds `https://cryoshield.app` and `OP Mainnet`, and finds neither "testnet only" nor "testnet-only"

### Requirement: RP ID binding explained
The README SHALL explain that a WebAuthn PRF output is bound to the credential's RP ID, that the recovery tool
therefore presents the same RP ID to the key through CTAP2 `hmac-secret`, which library does so (python-fido2), that
the key compares the RP ID as a label without resolving the name or contacting the website, and that the tool works
with the website offline. It SHALL name the tool's built-in RP ID and the flag that overrides it, SHALL say that the
vault records its RP ID, and SHALL state the residual risk that a future owner of the domain can run a site under the
same RP ID while the key still requires the PIN.

It SHALL state the salt mapping on a line of its own: the single PRF input, and that a CTAP2 client must send
`SHA-256("WebAuthn PRF" || 0x00 || input)` as the `hmac-secret` salt because the browser's PRF extension hashes its
input before the key sees it. It SHALL name where the tool does so, the specification section, and that the test
vectors carry both salts.

It SHALL explain that a wrong RP ID does not surface as a bad-key decrypt error: a name the key holds no credential
for is a named failure whose message points at the RP ID flag; with a vault ID or a file the RP ID is read from the
vault's own header; and the per-credential AES-256-GCM key wrap, matched by credential ID and verified before the
payload, is the key check, so "listed but did not unlock" and "not listed" are distinct messages, quoted from the tool.

#### Scenario: Names match the tool
- **WHEN** the README test reads the dependency section
- **THEN** it finds `python-fido2`, `hmac-secret`, the tool's `DEFAULT_RP_ID` in code formatting, `--rp-id`, and a
  sentence that the tool never contacts the website

#### Scenario: Salt mapping stated
- **WHEN** the README test reads the dependency section
- **THEN** it finds `SHA-256("WebAuthn PRF" || 0x00 ||`, the locator-salt input string from `derive.py`, a link to the
  specification's salt-mapping section, and the name of the tool module that applies the mapping

#### Scenario: Wrong RP ID explained with the tool's own messages
- **WHEN** the README test reads the dependency section
- **THEN** it finds the first sentence of the tool's "not listed" and "listed but did not unlock" messages, the prefix
  of its "no discoverable credential" message, `--vault-id` and `AES-256-GCM`

### Requirement: Dependency caveats
The README SHALL list every runtime dependency that remains after the project's own absence, and for each say what
stops and what keeps working. It SHALL say that gas sponsorship goes through one company (Pimlico), that if
sponsorship stops writes stop while unlocking in the app, the recovery tool and every existing vault keep working, that
the app then shows its "Saving is paused" message, and that there is no unsponsored fallback.

#### Scenario: Sponsorship stops
- **WHEN** the README test reads the dependency section
- **THEN** it finds `Pimlico`, `Saving is paused`, a statement that writes stop, and a statement that the app never
  falls back to an unsponsored write

### Requirement: Repeatable recovery drill
The README SHALL contain a recovery drill that a reader with a vault, one of its keys and that key's PIN can complete
in about ten minutes. The drill SHALL block `cryoshield.app` in the reader's hosts file before the tool runs, SHALL use
the tool's real commands including the testnet flag for preview vaults and the `--save-blob` then `--offline` variant,
SHALL end with the reader typing `show` and seeing the decrypted secret, SHALL tell the reader to use a throwaway
vault, and SHALL say what the drill proves and what it does not. The release checklist SHALL name the drill as the
recurring recovery check.

#### Scenario: Commands parse
- **WHEN** the README test extracts every `cryoshield-recover` command from the README's shell blocks, with
  placeholders replaced by valid values
- **THEN** each one parses with the tool's real argument parser

#### Scenario: Site blocked before the secret is shown
- **WHEN** the README test reads the drill section
- **THEN** the hosts-file line `127.0.0.1 cryoshield.app` appears before `show`, and the section mentions a test
  vault, `--testnet`, `--save-blob` and `--offline`

# Spec Delta

## MODIFIED Requirements

### Requirement: Candidate selection
Given all candidates from every source and every derived PRF output, the tool SHALL select the candidates whose wrapped key authenticates, and SHALL group them by the vault ID they were opened under. Within each vault ID, it SHALL rank the copies by freshness under the existing rules (prefer the on-chain current blob, then the latest verified Arweave blob, subject to the on-chain quorum and tie rules). When more than one vault ID has an authenticating copy, the tool SHALL list the vaults and ask the user to choose one interactively, unless `--vault-id` names one. In a non-interactive run without `--vault-id`, it SHALL exit with code 12 (`AMBIGUOUS`), printing only each vault's ID and status, and SHALL show no plaintext. Junk and malformed candidates SHALL be ignored silently, except for a count.

#### Scenario: Squatted locator
- **WHEN** a locator resolves to the genuine vault plus junk blobs, as in the candidate-list vector
- **THEN** the tool selects the genuine vault and reports how many candidates it ignored

#### Scenario: Nothing authenticates
- **WHEN** no candidate authenticates under any derived key
- **THEN** the tool reports "no matching vault" with next steps and shows no plaintext

#### Scenario: Two vaults on one key, interactive
- **WHEN** the tapped key's credentials open two different vault IDs in an interactive run
- **THEN** the tool lists both vaults and shows only the one the user chooses

#### Scenario: Two vaults, non-interactive
- **WHEN** the same two vaults are found in a non-interactive run without `--vault-id`
- **THEN** the tool prints both vault IDs and statuses, exits with code 12, and writes no plaintext

### Requirement: Explicit confirmation before showing secrets
The tool SHALL NOT print secret values until the user explicitly confirms at an interactive prompt after a warning about shoulder-surfing and screen capture. Before that confirmation it MAY list vault names, labels, item counts and archived status, made inert; it MUST NOT list any secret value. `--output <file>` SHALL instead write the plaintext to a new file with owner-only permissions. In non-interactive mode without `--output`, it SHALL refuse to print secret values.

#### Scenario: User declines
- **WHEN** the user answers anything other than the confirmation word
- **THEN** no secret value is printed and the tool exits successfully after zeroizing secrets

#### Scenario: Piped output
- **WHEN** stdin or stdout is not a terminal and `--output` is not given
- **THEN** the tool refuses to print the secret and explains `--output`

#### Scenario: Output file
- **WHEN** `--output secrets.txt` is given and the file does not exist
- **THEN** the plaintext is written with mode 0600 (or the platform equivalent), and an existing file is never overwritten

#### Scenario: Labels before confirmation
- **WHEN** a named vault is found and the confirmation prompt is shown
- **THEN** the vault's name and labels may appear above the prompt, and no secret value appears in the output before the user confirms

## ADDED Requirements

### Requirement: Payload-aware display
The tool SHALL decode payloads with a Python codec that follows `docs/spec/payload-v2.md`, accepts v1 and v2, and passes every positive and negative vector in `docs/spec/payload-vectors.json`; the tool SHALL pin that file by SHA-256 and fail its tests if the file changes. It SHALL show a decoded vault as its name (or "Unnamed vault"), its archived status, and each item as `label: secret`. For a payload it cannot decode (unknown version or malformed), it SHALL fall back to printing the raw decrypted text after the same confirmation, with a note that the vault was made by a newer version. Names and labels SHALL be made inert before printing (control, C1, line-separator and bidi characters removed or escaped). Decoded payload buffers SHALL be zeroized after use.

#### Scenario: Shared vectors
- **WHEN** the Python test suite runs the payload vectors
- **THEN** every positive vector round-trips byte-for-byte, every negative vector is rejected, and the vector file's SHA-256 matches the pin

#### Scenario: Bidi characters in a label
- **WHEN** a v1 vault's label contains U+202E
- **THEN** the label is printed with the character escaped and the line's text order is unchanged

#### Scenario: Unknown payload version
- **WHEN** a vault decrypts to a payload with `"v":3`
- **THEN** after confirmation the raw text is printed with a note that a newer CryoShield version made it

### Requirement: Vault listing mode
The tool SHALL provide `--list`, which runs discovery and decryption, then prints for each vault that decrypts its vault ID, name (or "Unnamed vault"), archived status, item count, key count and freshness status, and exits with code 0 without printing any label or secret value. Archived vaults MUST be listed.

#### Scenario: List includes archived vaults
- **WHEN** `--list` runs for a key holding one active and one archived vault
- **THEN** both vaults are printed with their status, and no label or secret value appears in the output

#### Scenario: List in a pipe
- **WHEN** `--list` runs with stdout not a terminal
- **THEN** it prints the same listing and exits with code 0

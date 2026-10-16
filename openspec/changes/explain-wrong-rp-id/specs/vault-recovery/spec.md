# Spec Delta

## MODIFIED Requirements

### Requirement: Candidates are opened under their own vault ID
Following vault-format-v1 §4.1, each candidate SHALL be opened under the vault ID it was found under, and that vault ID SHALL never come from the blob or its neighbouring data:
- the registry vault ID, for chain copies;
- the exact `CryoShield-Vault-Id` tag value, for Arweave copies;
- `--vault-id`, for a file.

Copies without a valid vault ID SHALL be ignored. Candidates SHALL be distinguished by (vault ID, blob), so a byte-identical clone never replaces the genuine copy.

When a key answers for a credential that a candidate lists but no wrapped key authenticates, the tool SHALL say that the key is listed in that vault but did not unlock it, SHALL name `--vault-id` as the thing to check for a file (a vault only decrypts under the vault ID it was registered under), and SHALL say that the copy may otherwise be damaged. That message SHALL be distinct from the one for a key that is not listed in any candidate. Neither case SHALL show plaintext or change the exit code.

#### Scenario: Clone listed before the genuine vault
- **WHEN** a locator resolves first to an attacker's vault ID holding a byte-identical copy of the victim's blob, then to the victim's vault ID
- **THEN** the clone fails authentication and is ignored, and the genuine vault is recovered and reported with its own vault ID

#### Scenario: Only a clone exists
- **WHEN** the only copies found are clones under other vault IDs (on-chain or Arweave-tagged), even with their own consistent event history
- **THEN** recovery fails with "no matching vault" and no plaintext is shown

#### Scenario: Wrong vault ID for a file
- **WHEN** `--blob-file` is used with a vault ID other than the one the blob was created for
- **THEN** no plaintext is shown, the exit code is "no matching vault", and the message says the key is listed in that vault but did not unlock it and names `--vault-id`

#### Scenario: Key not listed in the vault
- **WHEN** `--vault-id` names a vault whose entries list none of the key's credentials
- **THEN** the key returns no assertion, the exit code is "no credential", and the message says the key is not listed in that vault

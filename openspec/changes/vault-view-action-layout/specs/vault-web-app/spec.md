# Spec Delta

## ADDED Requirements

### Requirement: Vault actions layout
An open vault SHALL show its actions in three groups below the secrets, in this document and keyboard order: a single
full-width primary "Edit secrets" button in the floating action bar; a "Manage vault" section with a real heading over
a list of full-row buttons "Rename or archive", "Add a key" and "Details & backup file"; and a navigation row with
"All vaults (N)" (only when the vault list is available) and "Lock". For a read-only vault, "Edit secrets", "Rename or
archive" and "Add a key" SHALL NOT be shown, and "Details & backup file" SHALL remain. When no Manage row is shown, the
Manage vault heading and list MUST NOT be shown. Each row MUST be at least 44 px high, show a decorative chevron hidden
from assistive technology, and open the same screen as before.

#### Scenario: Grouped actions
- **WHEN** a user opens a writable vault from the vault list
- **THEN** the keyboard reaches Edit secrets, Rename or archive, Add a key, Details & backup file, All vaults (N) and Lock in that order, and the three rows are list items under a "Manage vault" heading

#### Scenario: Read-only vault
- **WHEN** a user opens a vault in the older read-only format
- **THEN** only "Details & backup file" is listed under Manage vault, and Edit secrets, Rename or archive and Add a key are absent

#### Scenario: No vault list
- **WHEN** a vault is open without a vault list
- **THEN** the navigation row shows Lock alone and no "All vaults" button

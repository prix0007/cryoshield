# Spec Delta

## ADDED Requirements

### Requirement: Vault actions layout
An open vault SHALL show its actions in this document and keyboard order: a single full-width primary "Edit secrets" button in the floating action bar; a "Manage vault" section with a real heading over a list, labelled by that heading, of full-row buttons "Rename or archive", "Add a key" and "Details & backup file"; and, when the vault list is available, a navigation row with "All vaults (N)". "Lock" SHALL be in the always-visible header bar while a vault is open, exactly once. For a read-only vault, "Edit secrets", "Rename or archive" and "Add a key" SHALL NOT be shown, and "Details & backup file" SHALL remain. When no Manage row is shown, the heading and list MUST NOT be shown. Each row MUST be at least 44 px high, show a decorative chevron hidden from assistive technology, and open the same screen as before.

#### Scenario: Grouped actions
- **WHEN** a user opens a writable vault from the vault list
- **THEN** the keyboard reaches Edit secrets, Rename or archive, Add a key, Details & backup file and All vaults (N) in that order, the three rows are list items under a "Manage vault" heading, and one Lock button is in the header bar

#### Scenario: Read-only vault
- **WHEN** a user opens a vault in the older read-only format
- **THEN** only "Details & backup file" is listed under Manage vault, and Edit secrets, Rename or archive and Add a key are absent

#### Scenario: No vault list
- **WHEN** a vault is open without a vault list
- **THEN** there is no navigation row, and Lock is still in the header bar

#### Scenario: Lock reachable from anywhere on the vault screen
- **WHEN** the user has scrolled a long vault
- **THEN** Lock is visible in the sticky header bar, and it is absent on screens with no open vault

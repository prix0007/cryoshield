# Spec Delta

## ADDED Requirements

### Requirement: Mainnet test record
The `/devices` page SHALL mention OP Mainnet in a key's "Tested" status only after that test happened on OP Mainnet, and then SHALL give its date and the exact flows tested (create, unlock, edit, add key, recovery tool). Until then, the page SHALL keep its existing statuses, and SHALL NOT imply that a mainnet launch implies wider device testing.

#### Scenario: Mainnet test claimed with evidence only
- **WHEN** the content test reads the keys table
- **THEN** any row that names OP Mainnet is "Tested" and has a date that is not in the future and a list of the flows tested

# Spec Delta

## ADDED Requirements

### Requirement: Write-failure reference
When a vault write fails, the error notice SHALL offer a collapsed "Details" disclosure. It holds a short error code
and, when the bundler or paymaster returned one, its JSON-RPC error code and message. The reference MUST NOT contain
URLs, secrets, key material, PRF output, signatures, calldata, or any hex value longer than 8 characters, and it is
never sent anywhere.

#### Scenario: Sponsorship refused shows a reference
- **WHEN** the paymaster refuses sponsorship with JSON-RPC error -32500 "policy cap reached for 0x1234…abcd"
- **THEN** the notice shows the plain message and a Details disclosure containing `SPONSORSHIP_REFUSED`, `-32500` and the message with the hex value elided

#### Scenario: Secrets never appear
- **WHEN** the underlying error message contains a bundler URL with an API key and a 32-byte hex value
- **THEN** neither the URL nor the hex value appears in the reference

### Requirement: Create-time sponsorship copy
A refused sponsorship while creating the first vault SHALL say "Nothing was saved. Please try again later." and MUST
NOT mention an existing vault.

#### Scenario: First create refused
- **WHEN** sponsorship is refused during vault creation
- **THEN** the error says "Nothing was saved. Please try again later." and does not contain "existing vault"

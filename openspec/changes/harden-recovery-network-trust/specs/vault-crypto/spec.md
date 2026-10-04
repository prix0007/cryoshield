# Spec Delta

## ADDED Requirements

### Requirement: Distinct key material at creation
Creating a vault SHALL fail with `INVALID_ARGUMENT` when any two credentials have equal PRF outputs, which also means equal locators. This keeps "N enrolled keys" from secretly being one key. The check MUST run after the credential-ID and PRF-length checks and before the secret and size checks, so existing error precedence is unchanged (verified by the `duplicate-prf` create vector).

#### Scenario: Same PRF output under two credential IDs
- **WHEN** a caller creates a vault with credentials A and B that have different IDs but identical PRF outputs
- **THEN** creation fails with `INVALID_ARGUMENT` and no blob is produced (the `duplicate-prf` vector)

# Spec Delta

## ADDED Requirements

### Requirement: Mainnet spend monitoring
The sponsorship runbook SHALL define, for OP Mainnet, the monitoring cadence (daily for the first 14 days after launch, weekly afterwards), the checks (balance, spend by policy, spend not attributed to the mainnet policy, per-operation cost, refusals, registry events) and a threshold with an action for each. At minimum: a balance below $50 triggers a usage review before any top-up; any sponsorship not attributed to the mainnet policy triggers a key rotation and the re-evaluation trigger review; the global daily cap being reached triggers an abuse review. Each review SHALL leave a dated entry in the runbook's review log. Monitoring SHALL need no CryoShield-operated server.

#### Scenario: Launch-period review recorded
- **WHEN** the first 14 days after the OP Mainnet launch have passed
- **THEN** the runbook's review log has a dated entry for each of those days, each naming the balance and any threshold crossed with the action taken

#### Scenario: Policy-less spend found
- **WHEN** a review finds mainnet sponsorship not attributed to the mainnet policy
- **THEN** the mainnet API key is rotated, and the review entry records the amount and the re-evaluation trigger decision

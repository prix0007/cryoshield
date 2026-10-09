# Spec Delta

## ADDED Requirements

### Requirement: Mainnet spend monitoring
The sponsorship runbook SHALL define, for OP Mainnet, the monitoring cadence (daily for the first 14 days after launch, weekly afterwards), the checks (balance, spend by policy, spend not attributed to the mainnet policy, per-operation cost, refusals, registry events) and a threshold with an action for each. At minimum: a balance below $50 triggers a usage review before any top-up; any sponsorship not attributed to the mainnet policy triggers a key rotation and the re-evaluation trigger review; the global cap being reached (daily, or the lifetime total when the policy has no reset) triggers an abuse review before it is raised. Each review SHALL leave a dated entry in the runbook's review log. Monitoring SHALL need no CryoShield-operated server.

#### Scenario: Launch-period review recorded
- **WHEN** the first 14 days after the OP Mainnet launch have passed
- **THEN** the runbook's review log has a dated entry for each of those days, each naming the balance and any threshold crossed with the action taken

#### Scenario: Policy-less spend found
- **WHEN** a review finds mainnet sponsorship not attributed to the mainnet policy
- **THEN** the mainnet API key is rotated, and the review entry records the amount and the re-evaluation trigger decision

## MODIFIED Requirements

### Requirement: Sponsorship limits
The live sponsorship policy for each chain SHALL set:
- a chain allowlist containing only that chain;
- a global spend limit and a global operation-count limit, both resetting daily;
- a per-sender operation-count limit (lifetime on testnet; resetting monthly on mainnet, so a long-lived user is never locked out for good);
- a per-user-operation spend limit.

The starting values SHALL be those in design D2 of `harden-gas-sponsorship`: testnet, 50 operations per sender lifetime, about 0.05 ETH (in USD) and 500 operations globally per day, and $0.50 per operation; mainnet (founder decision 2026-10-09, `launch-op-mainnet` design D8; previously 50 operations a month, $20 and 2,000 operations a day, and $0.10 per operation), 10 operations and $1.00 per sender per month, $30 and about 500 operations globally per day, and **$0.50 per operation**. The live values SHALL be recorded in `apps/web/docs/paymaster-policy.md` at `launch-op-mainnet` task 1.2 and whenever they change.

#### Scenario: Global cap reached
- **WHEN** the day's sponsored spend or count reaches the global limit (manual runbook check against the dashboard, task 1.1; the app side is unit-tested under "Refusal is visible and safe")
- **THEN** Pimlico refuses further sponsorship until the reset, and the app shows the refusal copy (see "Refusal is visible and safe")

#### Scenario: Fresh accounts do not escape the global cap
- **WHEN** a script submits operations from many new senders, each under the per-sender limit (manual runbook check of the dashboard usage page)
- **THEN** total sponsored spend for the day stays within the global limit plus Pimlico's documented in-flight pre-charge

#### Scenario: Mainnet per-operation cap
- **WHEN** the OP Mainnet policy is checked at `launch-op-mainnet` task 1.2
- **THEN** its per-user-operation spend limit is $0.50, its per-user limits reset monthly and its global limits reset daily, and the recorded values carry the date

### Requirement: Refusal is visible and safe
When sponsorship is refused for any reason (policy limit, missing balance, provider error), the app SHALL fail the write with `SPONSORSHIP_REFUSED`, send nothing, and show the refusal copy. On a test network that is "Saving is paused right now. Your existing vault is safe; please try again later." for edits and add-key, and "Nothing was saved. Please try again later." for a first create. On OP Mainnet (chain 10), whose limits reset (founder decision 2026-10-09), it is, for every write: "CryoShield could not pay the network fee for this save. Nothing was saved and your vault is unchanged. Sponsorship limits reset over time; if you’re adding a new secret, keep it somewhere safe until it saves." There SHALL be no unsponsored fallback. Existing vaults SHALL stay readable and unlockable.

#### Scenario: Balance exhausted
- **WHEN** the paymaster responds with an insufficient-balance error
- **THEN** the write fails with `SPONSORSHIP_REFUSED`, the edit copy says saving is paused, and no user operation is sent

#### Scenario: Refusal on OP Mainnet
- **WHEN** sponsorship is refused for a save on a chain-10 build
- **THEN** the message says the network fee could not be paid, that nothing was saved and the vault is unchanged, that limits reset over time, and to keep a new secret somewhere safe until it saves

#### Scenario: Unlock while paused
- **WHEN** sponsorship is refused and the user unlocks an existing vault
- **THEN** the unlock succeeds, because reads need only a public RPC

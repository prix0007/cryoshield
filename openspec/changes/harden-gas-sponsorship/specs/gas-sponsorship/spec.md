# Spec Delta

## ADDED Requirements

### Requirement: Third-party sponsorship under a mandatory policy
CryoShield SHALL sponsor user operations only through Pimlico's verifying paymaster. Every sponsorship request from the app SHALL carry the configured `sponsorshipPolicyId` as ERC-7677 paymaster context. CryoShield SHALL NOT operate a webhook, a proxy, or any other server in the sponsorship path. The app SHALL refuse to build without a valid `VITE_SPONSORSHIP_POLICY_ID` (covered by a config test).

#### Scenario: Policy ID on every request
- **WHEN** the app requests paymaster data for any write
- **THEN** the request context is `{ sponsorshipPolicyId: <configured id> }`, verified by a unit test on `createSponsor`

#### Scenario: Build without a policy ID
- **WHEN** the web app's configuration is loaded with `VITE_SPONSORSHIP_POLICY_ID` missing or containing invalid characters
- **THEN** it throws a configuration error naming the variable (unit test on `src/config/schema.ts`)

#### Scenario: No webhook
- **WHEN** the live policy is reviewed against the runbook (manual runbook check, tasks 1.2 and 8.1)
- **THEN** its webhook is disabled

### Requirement: Sponsorship limits
The live sponsorship policy for each chain SHALL set:
- a chain allowlist containing only that chain;
- a global spend limit and a global operation-count limit, both resetting daily;
- a per-sender operation-count limit (lifetime on testnet; resetting monthly on mainnet, so a long-lived user is never locked out for good);
- a per-user-operation spend limit.

The starting values SHALL be those in design D2: testnet, 50 operations per sender lifetime, about 0.05 ETH (in USD) and 500 operations globally per day, and $0.50 per operation; mainnet, 50 operations and $1.00 per sender per month, $20 and 2,000 operations globally per day, and $0.10 per operation. The live values SHALL be recorded in `apps/web/docs/paymaster-policy.md` whenever they change.

#### Scenario: Global cap reached
- **WHEN** the day's sponsored spend or count reaches the global limit (manual runbook check against the dashboard, task 1.1; the app side is unit-tested under "Refusal is visible and safe")
- **THEN** Pimlico refuses further sponsorship until the reset, and the app shows the refusal copy (see "Refusal is visible and safe")

#### Scenario: Fresh accounts do not escape the global cap
- **WHEN** a script submits operations from many new senders, each under the per-sender limit (manual runbook check of the dashboard usage page)
- **THEN** total sponsored spend for the day stays within the global limit plus Pimlico's documented in-flight pre-charge

### Requirement: API key restrictions and balance bound
Each environment SHALL use its own Pimlico API key, restricted to that environment's origin, with only bundler and paymaster methods enabled. If Pimlico offers a setting that requires a sponsorship policy (or specific policy IDs) on a key, it SHALL be enabled. The mainnet account SHALL be prepaid, with no card overdraft, and its balance SHALL be kept at about seven days of the global cap, so that sponsorship requests that bypass the policy are bounded by the balance.

#### Scenario: Key used from another website
- **WHEN** a page on another origin uses our API key from a browser (manual check, task 1.1)
- **THEN** Pimlico rejects the request

#### Scenario: Policy bypass bounded by the balance
- **WHEN** a script requests sponsorship with our key but without our policy, and Pimlico allows it (manual check, task 1.1)
- **THEN** the most it can spend is the prepaid balance, because there is no overdraft

### Requirement: Refusal is visible and safe
When sponsorship is refused for any reason (policy limit, missing balance, provider error), the app SHALL fail the write with `SPONSORSHIP_REFUSED`, send nothing, and show the existing refusal copy: "Saving is paused right now. Your existing vault is safe; please try again later." for edits and add-key, and "Nothing was saved. Please try again later." for a first create. There SHALL be no unsponsored fallback. Existing vaults SHALL stay readable and unlockable.

#### Scenario: Balance exhausted
- **WHEN** the paymaster responds with an insufficient-balance error
- **THEN** the write fails with `SPONSORSHIP_REFUSED`, the edit copy says saving is paused, and no user operation is sent

#### Scenario: Unlock while paused
- **WHEN** sponsorship is refused and the user unlocks an existing vault
- **THEN** the unlock succeeds, because reads need only a public RPC

### Requirement: Sponsorship runbook and re-evaluation trigger
`apps/web/docs/paymaster-policy.md` SHALL list the exact dashboard settings per environment (policy limits, key restrictions, balance), the facts confirmed in the dashboard and their dates, the honest abuse bound, a weekly review checklist, and the re-evaluation trigger for an own paymaster from design D6 (observed abuse or mainnet scale).

#### Scenario: Testnet per-sender lockout has a remedy
- **WHEN** a testnet sender reaches its lifetime operation count
- **THEN** the runbook states that the user sees "Saving is paused", and that the founder's remedy is to raise the cap in the dashboard; the user is never asked to pay gas

#### Scenario: Trigger fires
- **WHEN** the weekly review finds the global cap reached on two or more days in a seven-day window, or sponsorship that did not use our policy
- **THEN** the runbook directs the founder to open an OpenSpec change for an own paymaster

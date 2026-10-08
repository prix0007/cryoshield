# Spec Delta

## Purpose

Defines the privacy controls CryoShield, an open-source project with no company, maintains as a static,
non-custodial service: a data-flow inventory tied to the build, minimal hosting logs, a vendor list, erasure handling
for immutable data, incident response with public notice, and records reviewed on a schedule with a CI-enforced
mainnet gate. The records state facts; they are not legal advice and make no legal conclusions.

## ADDED Requirements

### Requirement: Data-flow inventory matches the build
The repository SHALL keep a data-flow inventory listing every party that receives data from a visitor or user, the data
it receives, its personal-data classification, and CryoShield's role. Every origin in the production `connect-src`
SHALL appear in the inventory and in the sub-processor list.

#### Scenario: New origin without inventory entry
- **WHEN** `verify-build` runs on a build whose `connect-src` contains an origin missing from the inventory
- **THEN** the build fails and names the origin

#### Scenario: Inventory complete
- **WHEN** the production build's origins are all listed
- **THEN** the check passes and prints each origin with its role

### Requirement: No CryoShield-side identifiers
The web app SHALL set no cookies, use no browser storage, and send no identifier it creates itself to any third
party beyond what the protocol requires (account address, user operation, signed Arweave data item).

#### Scenario: Full flow leaves nothing behind
- **WHEN** an E2E test creates, unlocks and updates a vault
- **THEN** `document.cookie` is empty, localStorage, sessionStorage and IndexedDB are empty, and no request carries a `Cookie` header

### Requirement: Minimal hosting logs
The static server SHALL NOT log full client IP addresses, user agents, query strings, or referrers. If request logs are
kept to meet a legal duty, each line SHALL hold only timestamp, method, path without query, status, and a truncated IP
(IPv4 /24, IPv6 /48), and SHALL be deleted when the documented legal period ends.

#### Scenario: Default server config logs nothing identifying
- **WHEN** the deploy test runs the container and serves 100 requests with distinct client IPs and query strings
- **THEN** no output line contains a full client IP, a user agent, or any query-string value

#### Scenario: Legally required logs are truncated
- **WHEN** request logging is enabled for a documented legal duty
- **THEN** every logged IP ends in a zeroed /24 (IPv4) or /48 (IPv6) and the inventory states the retention period and its legal basis

### Requirement: Platform logs documented
Logs kept by hosting and vendor platforms that CryoShield cannot disable SHALL be listed in the data-flow inventory
with what they contain, their retention (or "unpublished"), and the vendor's role.

#### Scenario: Unknown retention is flagged
- **WHEN** a vendor's retention period is not published
- **THEN** the inventory row says "unpublished" and the vendor list links the vendor's public terms

### Requirement: Erasure request handling
The project SHALL publish an erasure procedure that deletes everything the maintainers control (GitHub issue and
advisory content on request), points to each vendor for vendor-held data, and explains that public on-chain and Arweave copies cannot be
deleted, and that destroying or resetting every enrolled key leaves them undecryptable by any known technique
(crypto-shredding). It SHALL NOT claim that crypto-shredding equals erasure.

#### Scenario: Erasure request received
- **WHEN** a user opens a privacy-request issue or private advisory asking for erasure, with their account address
- **THEN** the procedure produces a written reply within 15 days (acknowledged within 24 hours) listing what was deleted, what cannot be, and the key-destruction steps, and the maintainers never ask for a secret, PIN or key

### Requirement: Breach and incident response
The project SHALL keep an incident runbook with severity levels, an incident lead, containment and evidence
preservation steps, and a public notice to affected users through every channel the project has (GitHub security
advisory, README, pinned issue, and the site once it is safe), with a deadline per severity. External reporting
regimes MAY be listed for reference; the runbook SHALL NOT depend on a company, a lawyer or a mailbox. A tabletop
exercise SHALL run at least yearly and before mainnet.

#### Scenario: Tabletop exercise
- **WHEN** the team runs the documented tabletop scenario "malicious bundle served from cryoshield.app"
- **THEN** each decision and its deadline is recorded in the exercise log, and each gap found is either fixed in the runbook or recorded with a proposed issue for the maintainer to file

### Requirement: Compliance records reviewed on a schedule
The data-flow inventory, vendor list, risk register, and legal pages SHALL be reviewed at least every six months and
before any mainnet deployment, including a check of every security claim on the legal pages against `openspec/specs`
and `docs/reviews`. Each review SHALL leave a dated entry in `docs/compliance/review-log.md` naming the reviewer.

#### Scenario: Mainnet gate
- **WHEN** a pull request adds a deployment record `contracts/deployments/<chainId>.json` for a chain that is not a local or testnet preset
- **THEN** a CI check fails unless the chain's launch record `docs/reviews/launch-<preset>.md` exists and the review log has an entry marked `mainnet-gate`, naming a reviewer, dated within the previous 30 days and not in the future

#### Scenario: Unknown chain fails closed
- **WHEN** a pull request adds `contracts/deployments/<chainId>.json` for a chain id that is not in `config/chain-presets.json`
- **THEN** the CI check fails and names the chain id

#### Scenario: Testnet records are not gated
- **WHEN** a pull request adds a record for chain 31337, 11155420 or 421614
- **THEN** the CI check passes without a launch record or review entry

#### Scenario: Claims check recorded
- **WHEN** a six-monthly review is logged
- **THEN** its entry lists each inaccurate security claim found on the legal pages and its fix, or states that none was found

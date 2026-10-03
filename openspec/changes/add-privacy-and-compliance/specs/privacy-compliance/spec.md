# Spec Delta

## Purpose

Defines the privacy and compliance controls CryoShield maintains as a static, non-custodial service: a data-flow
inventory tied to the build, minimal hosting logs, a sub-processor list, erasure handling for immutable data, breach
response, and the records that map to SOC 2 and to DPDP/GDPR/CCPA obligations.

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
- **THEN** the inventory row says "unpublished" and links the open request to the vendor

### Requirement: Erasure request handling
The project SHALL publish an erasure procedure that deletes everything CryoShield controls (support email, issue
data on request, vendor-held data via the vendor), and explains that public on-chain and Arweave copies cannot be
deleted, and that destroying or resetting every enrolled key leaves them undecryptable by any known technique
(crypto-shredding). It SHALL NOT claim that crypto-shredding equals erasure.

#### Scenario: Erasure request received
- **WHEN** a user emails an erasure request with their account address
- **THEN** the runbook produces a written reply within the statutory deadline listing what was deleted, what cannot be, and the key-destruction steps

### Requirement: Breach and incident response
The project SHALL keep an incident runbook with severity levels, an owner on call, evidence preservation, and
notification clocks for each regime: CERT-In, the Data Protection Board of India and affected Data Principals,
GDPR supervisory authorities and data subjects, US state notices, and affected users via the site banner.

#### Scenario: Tabletop exercise
- **WHEN** the team runs the documented tabletop scenario "malicious bundle served from cryoshield.app"
- **THEN** each notification decision and its deadline is recorded in the exercise log, and the gaps found are filed as issues

### Requirement: Compliance records reviewed on a schedule
The data-flow inventory, sub-processor list, risk register, and legal pages SHALL be reviewed at least every six months
and before any mainnet deployment. Each review SHALL leave a dated entry naming the reviewer.

#### Scenario: Mainnet gate
- **WHEN** a mainnet deployment record is added to `contracts/deployments/`
- **THEN** a CI check fails unless the review log has an entry dated within the previous 30 days marked `mainnet-gate`

# Spec Delta

## Purpose

Makes the app's "backup copy saved" status match reality for Arweave uploads via Turbo, keeps Retry working when chain
log queries fail, and gives operators a non-secret reason when the copy fails.

## ADDED Requirements

### Requirement: Copy found on either index
The app SHALL consider the Arweave copy of (vault ID, version) present if the fast-finality index OR the configured
gateway lists an item with those tags whose data is byte-identical to the on-chain blob. It SHALL NOT upload again in
that case.

#### Scenario: Not yet settled on arweave.net
- **WHEN** arweave.net's GraphQL returns no item but the fast index returns one with identical bytes
- **THEN** the copy is reported present and no upload is made

#### Scenario: Wrong bytes on the fast index
- **WHEN** the fast index returns an item whose data differs from the blob, and the gateway returns none
- **THEN** the app uploads a fresh copy

### Requirement: Retry uploads with known locators
A mirror retry SHALL upload with the locators the app already knows for the vault, adding any found in chain logs. A
failure to read chain logs MUST NOT prevent the upload.

#### Scenario: Logs unavailable on retry
- **WHEN** the first upload after create fails, `eth_getLogs` then fails, and the user presses Retry
- **THEN** the retry uploads with the locators known from creation and reports the copy saved

### Requirement: Mirror failure reference
A failed mirror SHALL show a collapsed "Details" disclosure with a code (`UPLOAD_FAILED`, `LOOKUP_FAILED` or
`NO_LOCATORS`), the HTTP status when there is one, and the failed step (lookup or upload). It MUST NOT include URLs,
keys or item contents.

#### Scenario: Upload refused
- **WHEN** Turbo answers the upload with HTTP 402
- **THEN** the notice offers Retry and a Details disclosure reading `UPLOAD_FAILED · HTTP 402 · upload`

### Requirement: Item link after upload
After a successful upload the app SHALL show the Arweave item ID, linked on the fast index, with a note that the
permanent arweave.net link works after settlement.

#### Scenario: Saved
- **WHEN** the upload succeeds with item ID `X`
- **THEN** "Backup copy saved." is shown with a link to `<fast index>/X` and the settlement note

### Requirement: Fast index allowed for the app only
The fast-index origin SHALL be configurable (`VITE_ARWEAVE_FAST_INDEX_URL`, https only, default
`https://turbo-gateway.com`). It SHALL appear in the app CSP's `connect-src`, and MUST NOT appear in the landing
document's CSP. Every origin SHALL be listed in the data-flow inventory.

#### Scenario: Per-route CSP
- **WHEN** `/app/` and `/` are requested from the container
- **THEN** the `/app/` CSP lists the fast-index origin in `connect-src` and the `/` CSP does not

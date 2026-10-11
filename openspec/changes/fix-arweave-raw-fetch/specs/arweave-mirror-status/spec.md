## MODIFIED Requirements

### Requirement: Copy found on either index
The app SHALL consider the Arweave copy of (vault ID, version) present if the fast-finality index OR the configured
gateway lists an item with those tags whose data is byte-identical to the on-chain blob. It SHALL read that data from
`<host>/raw/<id>` on the host that listed the item, and SHALL NOT follow a redirect. It SHALL NOT upload again in
that case.

#### Scenario: Not yet settled on arweave.net
- **WHEN** arweave.net's GraphQL returns no item but the fast index returns one with identical bytes
- **THEN** the copy is reported present and no upload is made

#### Scenario: Wrong bytes on the fast index
- **WHEN** the fast index returns an item whose data differs from the blob, and the gateway returns none
- **THEN** the app uploads a fresh copy

#### Scenario: Gateway redirects the plain item path
- **WHEN** a host answers `/<id>` with a redirect to a sandbox host and `/raw/<id>` with bytes identical to the blob
- **THEN** the copy is reported present, no upload is made, and no request goes to the sandbox host

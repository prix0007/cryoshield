## MODIFIED Requirements

### Requirement: Arweave fallback
When no RPC is usable, or no on-chain candidate authenticates, the tool SHALL query Arweave GraphQL for transactions tagged `App-Name: CryoShield` and `CryoShield-Locator: <lowercase 0x-prefixed hex locator>`, fetch each transaction's data from a gateway at `<gateway>/raw/<id>` without following any redirect, and treat each blob as a candidate. The built-in gateways SHALL each serve `/raw/<id>` directly (no redirect) at release time.

#### Scenario: Chain unreachable
- **WHEN** every RPC fails and the vault is mirrored to Arweave
- **THEN** the tool finds the blob through GraphQL, decrypts it, and states that the result came from Arweave

#### Scenario: Oversized Arweave data
- **WHEN** a tagged transaction's data exceeds 1024 bytes
- **THEN** it is skipped without being fully downloaded

#### Scenario: Gateway redirects the plain item path
- **WHEN** a gateway answers `/<id>` with a redirect to another host and `/raw/<id>` with the data
- **THEN** the tool downloads the data from `/raw/<id>` and never requests the redirect target

#### Scenario: One gateway unreachable
- **WHEN** the first gateway does not resolve or refuses the connection and the second serves `/raw/<id>`
- **THEN** the blob is downloaded from the second gateway and recovery continues

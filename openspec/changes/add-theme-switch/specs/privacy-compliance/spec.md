## MODIFIED Requirements

### Requirement: No CryoShield-side identifiers
The web app SHALL set no cookies, and send no identifier it creates itself to any third party beyond what the protocol
requires (account address, user operation, signed Arweave data item). It SHALL use no browser storage, except one
preference the visitor chooses: the theme (`localStorage["cryoshield-theme"]`, `light` or `dark`), which holds no
identifier, is never sent anywhere, and is deleted when the visitor chooses System.

#### Scenario: Full flow leaves nothing behind
- **WHEN** an E2E test creates, unlocks and updates a vault without choosing a theme
- **THEN** `document.cookie` is empty, localStorage, sessionStorage and IndexedDB are empty, and no request carries a `Cookie` header

#### Scenario: Theme preference is never sent
- **WHEN** an E2E test chooses Dark and loads every page
- **THEN** no request URL, header or body contains `cryoshield-theme` or the stored value as a parameter

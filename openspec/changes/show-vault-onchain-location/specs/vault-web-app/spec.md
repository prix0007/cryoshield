# Spec Delta

## Purpose

Lets the user see, and check independently, where their locked vault lives on the public chain and on Arweave, using
only public data the app already holds.

## ADDED Requirements

### Requirement: Public vault location
The open-vault view SHALL offer a "Where your vault is stored" disclosure, collapsed by default. When the user opens it,
it SHALL show:
- the configured network's name and chain ID;
- the address of the registry holding the vault, and whether it is version 2 or the read-only version 1;
- the vault ID;
- the vault's owner account address;
- the current version number.

It SHALL also show the last save's on-chain record (transaction hash) when, and only when, this session made the save
that produced the current version. It SHALL show the Arweave item ID when, and only when, this session uploaded or
byte-verified the Arweave copy of the current version.

The section SHALL state: "Anyone can see that this encrypted vault exists at this address; only your keys can open it."

#### Scenario: Opening the section
- **WHEN** a user unlocks a version-2 vault on OP Sepolia and opens "Where your vault is stored"
- **THEN** the app shows "OP Sepolia testnet" with chain ID 11155420, the VaultRegistry v2 address (version 2), the
  vault ID, the owner account address and the version

#### Scenario: Last save shown after saving here
- **WHEN** the user saves an edit in this session and the write returned a transaction hash
- **THEN** the section shows that hash as the last save

#### Scenario: Last save not known
- **WHEN** the user has only unlocked the vault in this session
- **THEN** the section shows no last-save row, and no log query is made to find one

### Requirement: Vault location copy and links
Each value in "Where your vault is stored" SHALL have a Copy button that copies the full value. On screen a long value MAY be truncated, but its full
value MUST be available to assistive technology. Addresses and the transaction hash SHALL link to the configured
network's block explorer, taken from the build-time network table, and SHALL show no link where the network has no
explorer. The Arweave item ID SHALL link to the configured Arweave gateway. Every link MUST open in a new tab only on
user activation, with `rel="noopener noreferrer"`.

#### Scenario: Explorer links
- **WHEN** the section is open on an OP Sepolia build
- **THEN** each address links to `https://testnet-explorer.optimism.io/address/<address>` in a new tab with
  `rel="noopener noreferrer"`, and the last save, when shown, links to `<explorer>/tx/<hash>`

#### Scenario: Copy
- **WHEN** the user presses the Copy button next to the vault ID
- **THEN** the full 32-byte vault ID is written to the clipboard and a "copied" status is announced

#### Scenario: Network without an explorer
- **WHEN** the app is built for the local anvil chain (31337)
- **THEN** the section shows the values with Copy buttons and no explorer links

### Requirement: Vault location shows public data only
"Where your vault is stored" MUST NOT show or copy key locators, credential IDs, salts, PRF output or any other key material. It MUST NOT
make any network request of its own: there is no `eth_getLogs` scan and no Arweave lookup for it, and it adds no CSP
`connect-src` source. Its content MUST be removed with the rest of the vault state on lock.

#### Scenario: No key material
- **WHEN** the section is open
- **THEN** no locator, credential ID or salt of the vault appears in the section's text, links or copy values

#### Scenario: Lock wipes the section
- **WHEN** the section is open and the vault locks (Lock button or auto-lock)
- **THEN** none of the section's values remains in the DOM

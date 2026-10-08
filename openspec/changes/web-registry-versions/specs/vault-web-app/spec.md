# Spec Delta

## MODIFIED Requirements

### Requirement: Registry deployment from contract output
The registry addresses and deployment blocks SHALL be read at build time from `contracts/deployments/<chainId>.json` for the configured chain ID, and never hardcoded. The build SHALL read an ordered list of every registry version in the record: the top-level `{address, deployBlock, txHash, abiHash}` as v1, `contracts.vaultRegistryV<N>` (v2 today) and `contracts.vaultRegistries.v<N>` as vN. The build MUST fail if that file is missing, if a v1 or v2 `abiHash` does not match the ABI the app is compiled against, if a version above 2 has an `abiHash` that equals no ABI the app knows, if a version or address is listed twice with different values, or if the newest registry lacks the write interface.

#### Scenario: ABI drift
- **WHEN** the deployment file's `abiHash` differs from the hash of the bundled VaultRegistry ABI
- **THEN** the build fails with a message naming both hashes

#### Scenario: Unknown chain
- **WHEN** `VITE_CHAIN_ID` names a chain with no deployment file
- **THEN** the build fails with a message naming the expected path

#### Scenario: Unknown registry version
- **WHEN** the record lists `contracts.vaultRegistries.v3` whose `abiHash` equals neither `VaultRegistry.json` nor `VaultRegistryV2.json`
- **THEN** the build fails with a message saying the app doesn't know VaultRegistry v3 and must be updated

#### Scenario: A v3 with the v2 interface
- **WHEN** the record lists `contracts.vaultRegistries.v3` whose `abiHash` equals the hash of `VaultRegistryV2.json`
- **THEN** the build succeeds with the registries v3, v2 and v1, newest first, and v3 read with the v2 interface

### Requirement: Public vault location
The open-vault view SHALL offer a "Where your vault is stored" disclosure, collapsed by default. When the user opens it,
it SHALL show:
- the configured network's name and chain ID;
- the address of the registry holding the vault, and its version number, marked read-only when it is not the newest registry;
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

#### Scenario: Vault in an older registry
- **WHEN** a user opens the section for a vault held in a registry that is not the newest
- **THEN** the app shows that registry's address and "Version N (read-only)"

#### Scenario: Last save shown after saving here
- **WHEN** the user saves an edit in this session and the write returned a transaction hash
- **THEN** the section shows that hash as the last save

#### Scenario: Panel fails to load
- **WHEN** the panel's code can't be loaded (offline, or the site was redeployed)
- **THEN** the panel shows "Couldn't load this section. Reload the page to try again." and the vault stays open and
  usable

#### Scenario: Results arrive out of order
- **WHEN** the self-heal check for version 3 finishes after the upload for version 4
- **THEN** the panel still shows version 4's Arweave copy

#### Scenario: Last save not known
- **WHEN** the user has only unlocked the vault in this session
- **THEN** the section shows no last-save row, and no log query is made to find one

## ADDED Requirements

### Requirement: Newest registry holding a vault is authoritative in the app
The app SHALL read every configured registry, newest first, and treat the candidates as one list. For each vault ID, the newest registry that holds it SHALL be authoritative: a copy of that ID in an older registry SHALL NOT be shown, whichever locator lists it. When a registry newer than the one listing an ID can't be read or contradicts itself, the read SHALL fail with "couldn't confirm the latest version" and SHALL NOT fall back to the older copy.

#### Scenario: v3 supersedes v2 and v1
- **WHEN** registries v3, v2 and v1 all hold the same vault ID with different copies
- **THEN** the app shows only v3's copy

#### Scenario: Newer registry unconfirmed
- **WHEN** an ID is listed only in v1 and the v2 or v3 RPC call fails
- **THEN** the unlock fails with the unconfirmed message and v1's copy is not shown

#### Scenario: Legacy vault still opens
- **WHEN** an ID is held only by v1 and both newer registries confirm they don't hold it
- **THEN** the app opens v1's copy, read-only

### Requirement: Writes go to the newest registry
Every write (create, update, add key, archive) SHALL target the newest configured registry only. A vault held by any older registry SHALL be read-only in the app.

#### Scenario: New vault with three registries
- **WHEN** a user creates a vault on a chain configured with v3, v2 and v1
- **THEN** the create call targets v3 only

#### Scenario: v2 vault after v3
- **WHEN** v3 is configured and a user opens a vault held by v2
- **THEN** the app shows it read-only and offers no edit

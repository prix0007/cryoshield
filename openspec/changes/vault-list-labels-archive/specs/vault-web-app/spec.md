# Spec Delta

## MODIFIED Requirements

### Requirement: Vault payload encoding v1
The decrypted payload SHALL be UTF-8 JSON `{"v":1,"items":[{"l":<label>,"s":<secret>}...]}` with no other fields. Labels are 0–64 characters; there is at least one item. Decoders MUST reject an unknown `v`. The encoding SHALL be published in `apps/web/docs/payload-v1.md` with fixed examples, so the recovery tool can reproduce it.

Writers SHALL emit v1 (the minimal version) whenever the vault has no name, no archived flag, no padding, and at least one item, and SHALL emit payload v2 otherwise. This rule SHALL be fixed by the vectors in `docs/spec/payload-vectors.json`.

#### Scenario: Round-trip
- **WHEN** items "Bitcoin seed" and "GitHub recovery codes" are saved and then unlocked
- **THEN** the same labels and secrets are shown in the same order

#### Scenario: Unnamed active vault stays v1
- **WHEN** a vault with no name and at least one item is saved and not archived
- **THEN** the payload written is byte-identical to the v1 encoding of its items, as in the minimal-version vectors

#### Scenario: Unknown payload version
- **WHEN** a decrypted payload has `"v":3`
- **THEN** the app shows "This vault was made by a newer version of CryoShield" and displays nothing

### Requirement: Capacity feedback
While the user edits secrets, the app SHALL show the space remaining, computed from `vault-crypto` `maxPayloadBytes` for the current keys. The space remaining SHALL count the encoded vault name and SHALL reserve the bytes needed to add the archived flag, so a vault that fits can always be archived. It MUST block saving when the encoded payload, plus that reserve, does not fit.

#### Scenario: Too much text
- **WHEN** the encoded payload would exceed the available bytes
- **THEN** the Save button is disabled and a message says how many characters to remove

#### Scenario: Full vault can still be archived
- **WHEN** a vault was saved with the space remaining at 0 and the user archives it
- **THEN** the archived payload fits and the archive is saved

### Requirement: Create-vault flow
The create flow SHALL guide the user through:
1. a short explanation;
2. enrolling key 1 and key 2 (with an option for more);
3. entering secrets, and an optional vault name;
4. saving;
5. a confirmation that tells them to store the keys in separate places.

Every step MUST use plain language without the words wallet, gas, seed phrase (except as a secret label example), smart account, or transaction.

The vault name SHALL be stored only inside the encrypted payload (payload v2). Each new credential's WebAuthn `user.name` and `user.displayName` SHALL be "CryoShield vault · <Mon YYYY> (key <n>)" with the creation month, and MUST NOT contain the vault name.

#### Scenario: Happy path
- **WHEN** a user completes the flow with two keys and one secret
- **THEN** the vault is stored on-chain, unlockable with either key, and the final screen tells them to keep the keys apart

#### Scenario: Jargon check
- **WHEN** the default-flow UI strings are scanned
- **THEN** none contain "gas", "wallet", "transaction", "smart account", "bundler", "paymaster", or "ETH"

#### Scenario: Named vault at creation
- **WHEN** a user names the vault "Family" in October 2026 and completes the flow
- **THEN** the single create write holds a v2 payload with `"n":"Family"`, and both credentials are labelled "CryoShield vault · Oct 2026 (key 1)" and "CryoShield vault · Oct 2026 (key 2)" with no "Family" in either

### Requirement: Unlock and view flow
The unlock flow SHALL be one button and one key tap. When exactly one active VaultRegistry v2 vault decrypts, it SHALL open directly; it then lists secrets with their labels, each hidden until the user chooses Show, with a Copy action. When more than one vault decrypts, or the only one is archived or on VaultRegistry v1, the app SHALL show the vault list (picker mode). If no vault matches the key, the app MUST say so plainly and offer to create a vault. The app MUST NOT say that no vault was found while an archived vault decrypted, and MUST NOT open an archived vault automatically.

#### Scenario: No vault for this key
- **WHEN** an enrolled-elsewhere or new key is tapped and no candidate authenticates
- **THEN** the app shows "We couldn't find a vault for this key" with a "Create a vault" action

#### Scenario: One active vault
- **WHEN** the tapped credential opens exactly one active VaultRegistry v2 vault
- **THEN** that vault opens directly with its name as the heading

#### Scenario: Only vault is archived
- **WHEN** the tapped credential's only vault that decrypts is archived
- **THEN** the vault list is shown with the archived section expanded and the note "This key's vault is archived", and no vault is opened automatically

### Requirement: Secrets in memory only with auto-lock
Decrypted secrets, vault names, labels and every opened vault in the vault list SHALL exist only in component memory, held by one owner. They MUST be cleared on the Lock action, after 5 minutes without user interaction, on page hide or unload, and after 60 seconds with the page hidden. The app MUST NOT persist any vault data, secret, label, vault name, credential ID or key material to browser storage, and MUST NOT write names or labels to the console, error references, analytics, the document title or the URL.

#### Scenario: Idle auto-lock
- **WHEN** an unlocked vault sees no interaction for 5 minutes
- **THEN** the secrets view is removed from the DOM and the unlock screen is shown

#### Scenario: Auto-lock clears the vault list
- **WHEN** the vault list shows three opened vaults and the page is hidden for 60 seconds
- **THEN** every opened vault is wiped from memory and the unlock screen is shown on return

#### Scenario: Storage stays empty
- **WHEN** any flow completes
- **THEN** localStorage, sessionStorage, IndexedDB, Cache Storage, and cookies contain no vault-related data

## ADDED Requirements

### Requirement: Vault payload encoding v2
The app SHALL decode payload v2: UTF-8 JSON with keys in the fixed order `v`, `n`, `a`, `items`, `z`, as `{"v":2,"n":<name>?,"a":true?,"items":[{"l":<label>,"s":<secret>}...],"z":<padding>?}`.
- `n` is present only when the vault has a name of 1–40 code points with no C0 or C1 control characters, no U+2028 or U+2029, no bidi controls U+202A–U+202E or U+2066–U+2069, no direction marks U+200E, U+200F or U+061C, and no format controls U+206A–U+206F.
- `a` is present only when the vault is archived, with the value `true`.
- `items` MAY be empty.
- `z` is present only when `items` is empty, as a non-empty string of ASCII `0`.

Decoders SHALL accept v1 and v2. They SHALL decode v1 payloads with the deployed v1 rules, unchanged, so a vault that opens today never stops opening. For v2 payloads they SHALL be strict and canonical: they MUST re-encode the decoded value and treat any byte difference (duplicate keys, whitespace, key order, `"a":false`, a non-boolean `a`, non-canonical escapes, ill-formed Unicode) as malformed. The encoding SHALL be published in `docs/spec/payload-v2.md`, with positive, negative and blob test vectors in `docs/spec/payload-vectors.json` that are generated deterministically and that the TypeScript and Python codecs both pass.

#### Scenario: Positive vectors
- **WHEN** the web codec runs every positive vector in `docs/spec/payload-vectors.json`
- **THEN** each decodes to the listed structure and re-encodes to the identical bytes

#### Scenario: Negative vectors
- **WHEN** the web codec decodes each negative vector (for example `"a":false`, `"a":1`, a duplicate `"n"`, reordered keys, or a name containing U+202E)
- **THEN** each is rejected as malformed and nothing is displayed

#### Scenario: Existing v1 vaults still open
- **WHEN** a v1 payload that today's decoder accepts, such as one with an escaped lone surrogate in a secret, is decoded by the v2 codec
- **THEN** it decodes to the same items as today

#### Scenario: Deterministic vectors
- **WHEN** the vector generator is run again
- **THEN** `docs/spec/payload-vectors.json` is byte-identical to the committed file

### Requirement: Your vaults menu
The app SHALL provide one vault list, loaded as a separate lazy chunk, used both as the unlock picker and as the "All vaults (N)" menu from an open vault. Each row SHALL show:
- the vault name, or "Unnamed vault";
- its status as text ("Active", "Archived", or "Older test vault");
- the item count;
- up to 3 labels, each truncated to 24 characters, followed by "+N more" when there are more;
- the key count, as "any 1 of N keys";
- the created and last-saved dates (see Vault dates from public block data).

Rows SHALL be grouped as active, archived, then older test vaults (VaultRegistry v1). In picker mode, archived vaults SHALL sit behind "Show archived (N)" and older test vaults behind "Open an older test vault"; in menu mode, every group SHALL be expanded. The list SHALL list every vault that decrypts under its own vault ID, regardless of its archived flag, and only those. Actions SHALL be Open, Edit vault, and Check another key. "Check another key" SHALL run one more key ceremony and merge the vaults it opens by vault ID, without storing any credential or vault identifier.

#### Scenario: Two keys, three vaults
- **WHEN** a user taps key A (two vaults), then chooses Check another key and taps key B (one of the same vaults and one more)
- **THEN** the list shows three distinct vaults, each once

#### Scenario: Row summary
- **WHEN** a vault named "Work" with 5 items and 3 keys is listed
- **THEN** its row shows "Work", "Active", 5 items, the first 3 labels and "+2 more", and "any 1 of 3 keys"

#### Scenario: Junk is not listed
- **WHEN** a locator also resolves to junk entries and a byte-identical clone under another vault ID
- **THEN** neither appears in the list

#### Scenario: Lazy chunk
- **WHEN** the production build is verified
- **THEN** the vault list is in a separate chunk not loaded by the landing page or the main app entry, and the main bundle stays within its budget

### Requirement: Vault name and archive state
From an open VaultRegistry v2 vault, the "Edit vault" sheet SHALL let the user set or clear the vault name and archive or unarchive the vault, and SHALL save all of these changes in one update. When nothing changed, Save MUST send nothing. Every edit of a vault's secrets MUST preserve its name and archived state. VaultRegistry v1 vaults SHALL be listed and opened read-only, with no name, archive or edit actions. An archived vault SHALL show an "Archived" notice with an Unarchive action. The menu copy SHALL say that any one of the vault's keys can rename or archive it.

#### Scenario: Rename and archive in one save
- **WHEN** a user renames a vault and archives it in the Edit vault sheet and chooses Save
- **THEN** exactly one update is sent, and after unlocking again the vault shows the new name and the Archived notice

#### Scenario: Edit keeps name and flag
- **WHEN** a user edits a secret in a named, archived vault and saves
- **THEN** the saved payload still has the same `n` and `"a":true`

#### Scenario: No-op save
- **WHEN** a user opens the Edit vault sheet and chooses Save without changing anything
- **THEN** no update is sent and no signature is requested

### Requirement: Archive and clear
The app SHALL offer "Archive and clear", which writes a v2 payload that keeps the vault name, sets `"a":true`, has no items, and has a `z` padding sized so the payload length equals the previous payload's length; the new blob MUST NOT be shorter than the previous blob. Before writing, the app MUST show an inline confirmation that requires the user to check "I understand old versions stay readable", and that says that earlier versions stay in public chain history and on Arweave, that anyone with one of the vault's keys and its PIN can still read them, and that a secret is only retired by changing it at its source.

#### Scenario: Size is preserved
- **WHEN** a vault with three items is archived and cleared
- **THEN** the new blob has the same length as the previous blob, and unlocking shows the name, the Archived notice and no items

#### Scenario: Confirmation required
- **WHEN** the user has not checked "I understand old versions stay readable"
- **THEN** the "Archive and clear" button is disabled and nothing is signed

### Requirement: Writes start from the current blob
Before every update to a vault (editing secrets, renaming, archiving, unarchiving, archive and clear, and adding a key), the app SHALL re-read the vault's current blob from the registry and compare it with the blob the session decrypted. If they differ, it MUST stop with a `STALE` error before any signature is requested, and SHALL tell the user "This vault changed since you opened it. Unlock again."

#### Scenario: Saved from another device
- **WHEN** a vault is updated from another device after this session opened it, and the user then saves an edit here
- **THEN** no signature is requested, nothing is written, and the app asks the user to unlock again

### Requirement: Vault dates from public block data
The app SHALL derive each listed vault's dates from the registry's `VaultCreated` and `VaultUpdated` events, read with paged `eth_getLogs` queries in bounded block ranges from the registry's deployment block, and the timestamps of their blocks. "Created" SHALL be the date of the `VaultCreated` block. "Last saved" SHALL be shown only when the latest event's `blobHash` equals keccak-256 of the current blob and its version matches the vault's version; otherwise the row SHALL say "Date unavailable". Dates MUST NOT be used for ordering, selection or freshness.

#### Scenario: Event history disagrees with the blob
- **WHEN** the latest `VaultUpdated` event's `blobHash` differs from the hash of the blob that decrypted
- **THEN** the row shows "Date unavailable" for Last saved, and the row order is unchanged

#### Scenario: Log query fails
- **WHEN** the RPC refuses the log query
- **THEN** the list still shows every vault, each with "Date unavailable"

### Requirement: Testnet save budget hint
When the configured chain is a testnet, the app SHALL estimate the sponsored saves left as 50 minus the account's `EntryPoint.getNonce(owner, 0)`. When the estimate is 10 or less it SHALL show "About N free saves left" next to Save, and when it is 0 it SHALL disable Save and show the existing "Saving is paused" message. On mainnet the hint MUST NOT be shown.

#### Scenario: Few saves left
- **WHEN** the account's EntryPoint nonce is 43 on OP Sepolia
- **THEN** the app shows "About 7 free saves left"

#### Scenario: Budget used up
- **WHEN** the account's EntryPoint nonce is 50 on OP Sepolia
- **THEN** Save is disabled and the "Saving is paused" message is shown

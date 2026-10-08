# Spec Delta

## ADDED Requirements

### Requirement: The create "saved" screen is under auto-lock
After a successful create, the new decrypted vault SHALL be held only where unlocked vaults are held, under the same auto-lock: 5 minutes without interaction (with the 30-second warning), page hide, and more than 60 seconds hidden. Locking from the "saved" screen SHALL wipe it and return to the home screen.

#### Scenario: Page hidden on the saved screen
- **WHEN** a user has just created a vault and the page fires `pagehide` before they press Continue
- **THEN** the app is locked on the home screen and the vault is no longer in memory or on screen

### Requirement: Vault dates over long chain histories
Vault dates SHALL be found however far the vault's events are before the latest block, within at most 200 log queries per registry, newest first, and SHALL keep the hostile-RPC bounds: abort on close or lock, the query cap, timestamp checks, and "Last saved" only when the newest event matches the decrypted blob.

#### Scenario: Events more than 46 days old
- **WHEN** a vault's events are 5 million blocks before the latest block
- **THEN** its Created and Last saved dates are shown

### Requirement: Staleness never trusts reads made after a write, and has a way out
The session's pinned nonce SHALL be set when the vault opens (or reopens after Reload) only from two equal nonce reads around a vault read that shows the session's own blob; otherwise saving SHALL be refused as changed. After a write the pin SHALL NOT be re-read: a failed save SHALL NOT move it, and a successful save SHALL move it locally by one. A save SHALL NOT be refused as changed merely because an RPC lags the session's own successful save (re-read before refusing). When a save is refused as changed, the app SHALL offer "Reload vault".

#### Scenario: Lagging RPC after the session's own save
- **WHEN** a save succeeds and the RPC still returns the previous nonce and blob for the next save
- **THEN** the next save is not refused as changed

#### Scenario: Retry after a failed save
- **WHEN** a save fails (reverted, nonce conflict, not confirmed or a network error) and the user saves again
- **THEN** the app refuses it as changed, sends nothing, and offers "Reload vault"

#### Scenario: Changed on another device
- **WHEN** the vault was changed on another device and the user saves
- **THEN** nothing is saved, the app says the vault changed, and "Reload vault" loads the current version after one key tap

### Requirement: Every save respects the zero-saves-left gate
Unarchive SHALL be disabled, with "Saving is paused", when no free saves are left, like every other save.

#### Scenario: Unarchive at zero saves
- **WHEN** an archived vault is open on a testnet account with no free saves left
- **THEN** Unarchive is disabled and nothing is sent

### Requirement: Never a silently short vault list
For a paged locator, `locatorLength` SHALL be the source of truth. If the pages don't add up to it, the app SHALL show "We couldn't load all of your vaults" instead of a partial list.

#### Scenario: Short RPC page
- **WHEN** a `resolveLocator` page is empty or short before `locatorLength` is reached
- **THEN** no vault list is shown and the app asks the user to try again

### Requirement: Version-neutral read-only wording
Vaults in an older registry SHALL be labelled "Read-only vault (older format)", without calling them test vaults.

#### Scenario: v2 vault after v3
- **WHEN** v3 is configured and a v2 vault is listed
- **THEN** its status reads "Read-only vault (older format)"

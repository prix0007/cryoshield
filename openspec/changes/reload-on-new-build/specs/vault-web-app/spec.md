## ADDED Requirements

### Requirement: Writes refuse an outdated app build
Before any on-chain write (create, edit, rename, archive, Archive and clear, add-key), and before any key tap for it, the app SHALL fetch its own page from the same origin without using the HTTP cache and compare the page's module entry scripts with the ones the running document loaded. When they differ, the app MUST NOT write, MUST NOT start a key ceremony, and MUST tell the user in plain language that CryoShield was updated and that reloading the page discards unsaved changes, with a Reload page button. The check MUST run on every write, also after the write code has already been loaded. When the check cannot decide (network error, no response within 4 seconds, a non-success status, a non-HTML response, or no module script in either document), the write SHALL go ahead. The check MUST send no vault data, key material or identifiers, and MUST NOT store anything, including the draft.

#### Scenario: Save from a tab opened before a deploy
- **WHEN** an unlocked user saves an edit and the served app page names a different module entry script than the running tab
- **THEN** nothing is written, no key tap is requested, the edited text stays on screen, and an alert says CryoShield was updated and offers Reload page

#### Scenario: Add-key and create are checked too
- **WHEN** the build check reports an update at the start of add-key or of saving a new vault
- **THEN** the flow stops before its first key tap with the same message

#### Scenario: The check cannot decide
- **WHEN** the page fetch fails, times out or returns something other than an HTML page with a module script
- **THEN** the write proceeds as before

#### Scenario: Current build
- **WHEN** the served page names the same module entry script as the running tab
- **THEN** the write proceeds as before

### Requirement: Reload offer for an outdated or missing app build
When the app tab becomes visible again (at most once per minute, and once at start) and the build check reports an update, the app SHALL show a non-blocking notice that a new version is available, with a Reload page button. Wherever a lazily loaded part of the app failed to load (the vault location panel, an app section, or the save code), the message SHALL also offer a Reload page button. A reload MUST only ever start from the user's action.

#### Scenario: Returning to an old tab
- **WHEN** the user returns to a tab whose build has been replaced on the server
- **THEN** a status notice says a new version is available and offers Reload page

#### Scenario: Vault location chunk missing
- **WHEN** the "Where your vault is stored" section cannot load its code
- **THEN** it says the section could not load and offers Reload page

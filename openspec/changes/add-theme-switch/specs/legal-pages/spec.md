## MODIFIED Requirements

### Requirement: Cookie policy page
The site SHALL serve a static cookie policy at `/cookies` that states whether any cookie or similar technology is
used on each route, publishes the device-storage inventory, describes the landing-page analytics beacon and how
GPC/DNT suppress it, and explains when a consent banner would be introduced. It SHALL disclose the one preference a
visitor can choose to have remembered (the theme): its key, its possible values, when it is saved and deleted, that it
holds no identifier, that it is never sent anywhere, and how to clear it.

#### Scenario: Required sections present
- **WHEN** the built `/cookies` page is checked by a test
- **THEN** it contains the headings What we store on your device, Analytics on the landing page, Your choices, When this would change, and an effective date

#### Scenario: Theme preference disclosed
- **WHEN** the built `/cookies` and `/privacy` pages are checked by a test
- **THEN** each names `cryoshield-theme`, says it is saved only when you choose Light or Dark, that it is never sent anywhere, and how to clear it, and neither says that nothing is stored on your device

### Requirement: Device-storage inventory
The cookie policy SHALL contain a table listing every cookie, localStorage, sessionStorage, IndexedDB, Cache Storage
or service-worker entry that any CryoShield page or embedded third party creates, per route, with purpose and
lifetime, and a table of the preferences saved only when the visitor chooses them. An E2E test SHALL fail if a page
creates any entry not listed.

#### Scenario: Inventory matches reality
- **WHEN** an E2E test loads `/` (beacon allowed), then `/app/` and runs create and unlock, then loads each legal page
- **THEN** the cookies and storage it finds per route equal the published inventory, which lists no entries a page creates on its own

#### Scenario: Chosen preference matches the inventory
- **WHEN** the E2E test chooses Dark in the theme switch on each route, then chooses System
- **THEN** after Dark the only entry found is the listed preference `cryoshield-theme`, and after System nothing is stored

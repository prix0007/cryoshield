# Spec Delta

## Purpose

Defines the public legal and trust pages of cryoshield.app (privacy policy, terms of service, cookie policy, security
contact) and the
in-app disclosures users must see before their encrypted data is written permanently to public networks.

## ADDED Requirements

### Requirement: Privacy policy page
The site SHALL serve a static privacy policy at `/privacy` that states: the open-source operator, the GitHub contact
channels and the Grievance Officer as defined by `project-contact`, what data each third party receives, the public
and permanent nature of on-chain and Arweave data with every public field listed, retention, user rights and how to
exercise them, the age statement, and its effective date. It MUST NOT name a company or a registered address.

#### Scenario: Required sections present
- **WHEN** the built `/privacy` page is checked by a test
- **THEN** it contains the headings Who we are, What we never see, Data held by third parties, Public and permanent data, Analytics, Your rights, Grievance Officer, Children, Changes, and an effective date

#### Scenario: Analytics disclosed
- **WHEN** the built `/privacy` page is checked
- **THEN** its Analytics section names Cloudflare Web Analytics, states it runs on the landing page only, lists the data it reads, says no cookies are set, and says GPC/DNT turn it off

#### Scenario: Every public field listed
- **WHEN** the built `/privacy` page's "Public and permanent data" section is checked against the on-chain and Arweave inventory in `docs/compliance/data-inventory.md`
- **THEN** it lists the ciphertext, earlier versions, the account address and vault ID, each key's public signing key, the locators, the key count and credential IDs, the size range, the save times and the Arweave upload address, and says that unlocking needs a key and its PIN

#### Scenario: Linked everywhere
- **WHEN** the landing page, the app shell, and each legal page are rendered
- **THEN** each has a visible link to `/privacy`, `/terms` and `/cookies`

### Requirement: Terms of service page
The site SHALL serve static terms at `/terms` covering: testnet and unaudited status, no custody and no recovery after all
keys are lost, permanence of published data, sponsored gas that may be paused or withdrawn without notice, acceptable
use, sanctions eligibility, minimum age, MIT software licence, disclaimers, limitation of liability, and governing law.

#### Scenario: Testnet warning present
- **WHEN** the deployment targets a testnet chain
- **THEN** `/terms` and the app shell both show the testnet and unaudited warning

### Requirement: Cookie policy page
The site SHALL serve a static cookie policy at `/cookies` that states whether any cookie or similar technology is
used on each route, publishes the device-storage inventory, describes the landing-page analytics beacon and how
GPC/DNT suppress it, and explains when a consent banner would be introduced.

#### Scenario: Required sections present
- **WHEN** the built `/cookies` page is checked by a test
- **THEN** it contains the headings What we store on your device, Analytics on the landing page, Your choices, When this would change, and an effective date

### Requirement: Device-storage inventory
The cookie policy SHALL contain a table listing every cookie, localStorage, sessionStorage, IndexedDB, Cache Storage
or service-worker entry that any CryoShield page or embedded third party creates, per route, with purpose and
lifetime. An E2E test SHALL fail if a page creates any entry not listed.

#### Scenario: Inventory matches reality
- **WHEN** an E2E test loads `/` (beacon allowed), then `/app/` and runs create and unlock, then loads each legal page
- **THEN** the cookies and storage it finds per route equal the published inventory, which today lists no entries

### Requirement: Legal pages are tracker-free
The `/privacy`, `/terms` and `/cookies` pages SHALL load no analytics, no third-party scripts, fonts or images, and SHALL be served
with the app CSP.

#### Scenario: No third-party requests
- **WHEN** an E2E test loads `/privacy`, `/terms` and `/cookies`
- **THEN** every request goes to the site origin

### Requirement: Versioned legal text
Every change to the privacy policy, terms or cookie policy SHALL update the effective date and add a dated entry to a changelog
section on the page. The source text SHALL live in the repository so its history is public.

#### Scenario: Date changes with content
- **WHEN** a CI check compares a change to the policy source with its effective date
- **THEN** it fails if the text changed but the effective date did not

### Requirement: Permanence acknowledgement before first write
Before a vault is first written, the app SHALL show, in plain language, that the encrypted vault, its locators, the
key count and credential IDs, and the account address are published permanently on a public blockchain and Arweave
and cannot be deleted by anyone. Creation SHALL require an explicit acknowledgement each time.

#### Scenario: Cannot create without acknowledging
- **WHEN** a user reaches the save step without ticking the acknowledgement
- **THEN** the save button is disabled and no bundler, paymaster or Arweave request is made

#### Scenario: Acknowledgement is not stored
- **WHEN** the user acknowledges and saves
- **THEN** no cookie, browser storage, or network field records the acknowledgement

### Requirement: Age statement
The terms, the privacy policy and the create flow SHALL state that CryoShield is intended only for people aged 18 or
over. The create flow SHALL ask the user to confirm they are 18 or over, in the same step as the permanence acknowledgement.

#### Scenario: Under-18 path
- **WHEN** the user does not confirm being 18 or over
- **THEN** the vault cannot be saved and the page explains why

### Requirement: Security contact file
The site SHALL serve `/.well-known/security.txt` per RFC 9116, with `Contact`, `Expires`, `Policy`, `Canonical`,
and `Preferred-Languages` fields. `Contact` SHALL be the GitHub private vulnerability reporting URL only, as defined by
`project-contact`. A build check SHALL fail when `Expires` is in the past or more than 365 days ahead.

#### Scenario: Expiry guard
- **WHEN** `verify-build` runs with a security.txt whose `Expires` is 400 days ahead
- **THEN** the build fails with a message naming the field

#### Scenario: Served as text
- **WHEN** the container test requests `/.well-known/security.txt`
- **THEN** it returns 200 with `Content-Type: text/plain; charset=utf-8` and the canonical URL `https://cryoshield.app/.well-known/security.txt`

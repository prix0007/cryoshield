# Spec Delta

## Purpose

One honest guide for a lost or compromised security key: one Markdown source in the repository, deployed at
`/lost-key`, linked from the vault view, the landing FAQ and every footer.

## ADDED Requirements

### Requirement: Single source rendered at /lost-key
The guide SHALL live in `docs/lost-or-compromised-key.md` and SHALL be rendered at build time into a static page at `/lost-key` with the legal-pages Markdown renderer (HTML-escaped, link-scheme allowlist). The page SHALL carry the app CSP and every security header, load no script other than the shared theme script, make no third-party request, include no analytics, and be served with `no-cache`. It SHALL carry a "Last reviewed" date that is valid and not in the future.

#### Scenario: Route served
- **WHEN** `/lost-key` is requested from the container
- **THEN** it returns 200 with the rendered page, the app CSP and every security header, `/lost-key/` is 200, and `/lost-key/x` is 404

### Requirement: Honest about what a key can do
The guide SHALL state that every key always needs its PIN; that any one key with its PIN can open the vault and change it; that every saved version stays public forever and can be read by anyone holding any of the vault's keys and its PIN; and that CryoShield cannot remove a key, lock a key out, delete old versions or recover anything. It SHALL NOT claim that editing, clearing or adding keys protects secrets already stored, and SHALL NOT state a PIN-attempt count.

#### Scenario: No false comfort
- **WHEN** the content tests read the guide
- **THEN** it contains the old-versions and any-key statements, quotes the app's "Archive and clear" warnings verbatim, and contains no claim that a key can be removed or old versions deleted

### Requirement: Two situations and ordered steps
The guide SHALL distinguish a key lost or stolen with its PIN still secret from a key whose PIN, or whose unlocking device, may be compromised, and SHALL tell the reader to follow the compromised steps when unsure. The steps SHALL be, in order: use a trusted device and a trusted key; change the secrets at their source; create a new vault with at least two trusted keys and never the compromised key; archive and clear the old vault; update backups and notes; reset or retire the compromised key last.

#### Scenario: Order kept
- **WHEN** the content tests read the step headings
- **THEN** they appear in exactly that order, and the reset step says a reset erases every credential on the key

### Requirement: Safe guidance
The guide SHALL tell readers never to give anyone their seed phrases, recovery codes, PINs or keys, including someone claiming to be from CryoShield, and SHALL NOT ask the reader to contact CryoShield to recover anything.

#### Scenario: Warning present
- **WHEN** the content tests read the guide
- **THEN** the never-share warning is present and no sentence offers recovery by CryoShield

### Requirement: Linked from the app, the FAQ and every footer
The vault view SHALL link the guide under "Manage vault" with the text "Lost a key, or think someone has it?". The landing FAQ "What happens if I lose my YubiKey?" SHALL link it. The footers of the landing page, `/app`, every legal-partial page, `/architecture`, `/devices`, `/support` and `/lost-key` SHALL link it as "Lost or compromised key".

#### Scenario: Reachable from an unlocked vault
- **WHEN** a user unlocks a vault on desktop or mobile
- **THEN** the vault view shows the link, and following it opens `/lost-key` with its heading

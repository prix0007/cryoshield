# Spec Delta

## ADDED Requirements

### Requirement: Mainnet audit status only in the footer and legal pages
On a build for a main network, the public site SHALL state that CryoShield has not been independently audited only in
the footer's legal line (on every page, outside any collapsible), on `/terms` and on `/privacy`. Every other place SHALL
NOT say "unaudited" or "(not) (been) independently audited". This covers:
- the landing hero status strip, call-to-action fine print, sub-nav chip, FAQ answers and meta description;
- the shared legal header chip;
- `llms.txt`, apart from the `/terms` and `/privacy` entries;
- the share image and its alt text.

Where a sentence needs a replacement, it SHALL state only true facts (open source, on-device encryption with open-source
libraries, published test vectors, public internal security reviews, the recovery tool). It SHALL keep the existing
backup advice as normal practice. It MUST NOT claim or imply an audit. The all-keys-lost warning SHALL stay. On a test
network the landing page and the legal header are unchanged.

#### Scenario: Mainnet hero, calls to action and chip
- **WHEN** the landing page built for chain 10 is rendered with scripts disabled
- **THEN** the hero status strip reads "Runs on OP Mainnet. Your vault is encrypted on your device and stored on OP Mainnet, with an extra copy on Arweave when that upload succeeds.", neither call to action has a fine-print paragraph, and the sub-nav has no chip and no empty paragraph

#### Scenario: Mainnet FAQ and metadata
- **WHEN** the landing page built for chain 10 is read, including its FAQ answers and meta description
- **THEN** "Is it safe to use today?" names OP Mainnet, on-device encryption with @noble, open-source code, vault format and test vectors, public internal security reviews and the recovery tool, and ends "As with any backup, keep a second copy somewhere safe."; the meta description ends "Free and open source."; and outside the footer's legal line no text says "unaudited" or "independently audited"

#### Scenario: Audit status kept where required
- **WHEN** the chain-10 build's public pages are read
- **THEN** every page's footer legal line says "not independently audited", `/terms` and `/privacy` say CryoShield "has not been independently audited", and no other page, meta tag, image alt or `llms.txt` line (apart from the `/terms` and `/privacy` entries) says "unaudited" or "independently audited"

#### Scenario: No audit claim
- **WHEN** the chain-10 public pages and `llms.txt` are checked against the honesty denylist
- **THEN** no audit claim or audit promise appears

#### Scenario: Testnet unchanged
- **WHEN** the landing page built for chain 11155420 is rendered
- **THEN** the chip reads "Testnet preview", both calls to action keep "Testnet preview on OP Sepolia, not independently audited. Please keep your existing backups too.", and the hero strip and FAQ answers keep their testnet wording

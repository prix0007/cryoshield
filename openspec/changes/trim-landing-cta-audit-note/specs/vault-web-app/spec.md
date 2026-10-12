# Spec Delta

## ADDED Requirements

### Requirement: Mainnet app shell without an audit tag
On a build for a main network, the app shell SHALL show no network chip in its sub-nav, and its network status notice
SHALL NOT say "unaudited" or "(not) (been) independently audited". The notice SHALL still name the network, say that the
vault is published permanently as ciphertext, give the all-keys-lost warning, and advise keeping existing backups. On a
test network, and on an unknown chain, the "Testnet" chip and the testnet banner are unchanged.

#### Scenario: Mainnet app shell
- **WHEN** the app built for chain 10 is opened
- **THEN** the notice reads "CryoShield runs on OP Mainnet. Your vault is encrypted on your device and published permanently as ciphertext on a public blockchain, and only your keys can open it: if you lose every key, nobody, including CryoShield, can open it. Please keep your existing backups too.", and the sub-nav has no chip

#### Scenario: Test network unchanged
- **WHEN** the app built for chain 11155420, or for an unknown chain, is opened
- **THEN** the "Testnet" chip and the testnet banner, including "has not been independently audited", are shown

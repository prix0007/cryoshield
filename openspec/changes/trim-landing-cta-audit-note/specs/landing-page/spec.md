# Spec Delta

## ADDED Requirements

### Requirement: Mainnet calls to action without an audit note
On a build for a main network, the landing page's hero status strip and the fine print of its calls to action SHALL NOT
repeat the audit and backup note: the hero strip SHALL name the network and say where the vault is stored, and the
calls to action SHALL have no fine-print paragraph (not even an empty one). The landing page SHALL still state, in
visible text, that CryoShield has not been independently audited: in the footer, outside any collapsible, and in the
FAQ answer "Is it safe to use today?". It MUST NOT claim to be audited. On a test network the hero strip and the call
to action fine print are unchanged.

#### Scenario: Mainnet hero and calls to action
- **WHEN** the landing page built for chain 10 is rendered with scripts disabled
- **THEN** the hero status strip reads "Runs on OP Mainnet. Your vault is encrypted on your device and stored on OP Mainnet, with an extra copy on Arweave when that upload succeeds.", and neither the breaches call to action nor the final call to action has a fine-print paragraph

#### Scenario: Audit status still visible on mainnet
- **WHEN** the landing page built for chain 10 is rendered with motion disabled and with scripts disabled
- **THEN** the footer reads "Runs on OP Mainnet, not independently audited.", the FAQ answer "Is it safe to use today?" says CryoShield "has not been independently audited", and no audit claim appears

#### Scenario: Testnet calls to action unchanged
- **WHEN** the landing page built for chain 11155420 is rendered
- **THEN** both calls to action keep the fine print "Testnet preview on OP Sepolia, not independently audited. Please keep your existing backups too." and the hero strip keeps its testnet wording

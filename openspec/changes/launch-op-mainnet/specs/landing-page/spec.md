# Spec Delta

## MODIFIED Requirements

### Requirement: Honest landing content
The landing page SHALL state, in visible text that is not hidden behind interaction:
- the network the build targets, taken from the build's chain ID: on a test network, that CryoShield runs on a testnet and its name (for example "OP Sepolia"); on OP Mainnet, "OP Mainnet";
- that it has not been independently audited, on every network;
- that losing ALL enrolled keys means the vault cannot be opened by anyone, on every network.

An unknown chain ID SHALL be treated as a test network. The landing page MUST NOT claim a capability the shipped code lacks, MUST NOT claim to be audited, and MUST NOT use third-party trademarks as its own branding.

#### Scenario: Required disclosures present
- **WHEN** the landing page built for chain 11155420 is rendered with motion disabled and with scripts disabled
- **THEN** the texts "OP Sepolia", "Testnet preview", "not been independently audited" (or equivalent) and the all-keys-lost warning are visible

#### Scenario: Required disclosures present on a mainnet build
- **WHEN** the landing page built for chain 10 is rendered with motion disabled and with scripts disabled
- **THEN** the texts "OP Mainnet", "not been independently audited" (or "unaudited") and the all-keys-lost warning are visible, and neither "OP Sepolia" nor "Testnet" appears

#### Scenario: No overclaiming
- **WHEN** the landing copy for either chain is checked against a denylist of unsupported claims (e.g. "audited" as a claim, "military-grade", "unhackable", "guaranteed", "risk-free", "insured", "never lose", "Ethereum L1 anchor")
- **THEN** none appears as an affirmative claim, and "mainnet" appears only on a build for a mainnet chain

# Spec Delta

## ADDED Requirements

### Requirement: User verification and RP binding on every signature
`CryoShieldSmartWallet` SHALL accept a signature from a P-256 owner only when all of the following hold, for user operations (including `executeWithoutChainIdValidation`) and for ERC-1271 `isValidSignature`:
- `authenticatorData` is at least 37 bytes long;
- `authenticatorData[0:32]` equals the immutable `RP_ID_HASH = sha256(rpId)` fixed at deployment;
- the flags have UP (`0x01`) and UV (`0x04`) set;
- the WebAuthn assertion verifies, as in CBSW v1.1.

Any other signature SHALL be invalid (`SIG_VALIDATION_FAILED` for user operations). This SHALL be tested against the WebAuthn fixtures in `contracts/test/fixtures/webauthn/`: a valid UV=1 assertion, and the same assertion with UV=0, UP=0, a foreign rpIdHash, and authenticatorData shorter than 37 bytes. Each negative fixture is re-signed, so that only the tested property differs.

#### Scenario: Stolen key without PIN
- **WHEN** a user operation is correctly signed by an owner key but its authenticator data has UV = 0
- **THEN** account validation fails and the EntryPoint does not execute it

#### Scenario: Credential for another RP
- **WHEN** a correctly signed assertion's rpIdHash is not `sha256(rpId)`
- **THEN** validation fails, for both a user operation and ERC-1271

#### Scenario: Replayable path is covered
- **WHEN** an `executeWithoutChainIdValidation` operation (for example `addOwnerPublicKey`) is signed with UV = 0
- **THEN** validation fails

#### Scenario: Valid tap with PIN
- **WHEN** the UV=1 fixture signs a user operation for the fixture account
- **THEN** validation returns 0 and the operation executes

### Requirement: P-256 owners only, at most eight
The account SHALL hold only 64-byte P-256 public-key owners, and at most `MAX_OWNERS = 8` of them at any time. `initialize` SHALL require 1–8 owners, each exactly 64 bytes. `addOwnerAddress` SHALL always revert. `addOwnerPublicKey` SHALL revert when the account already has 8 owners. A signature attributed to an owner that is not 64 bytes long SHALL be invalid.

#### Scenario: Address owner refused at creation
- **WHEN** the factory is called with a 32-byte address owner among the owners
- **THEN** account creation reverts

#### Scenario: Ninth owner refused
- **WHEN** an account with 8 owners calls `addOwnerPublicKey`
- **THEN** the call reverts and the owner set is unchanged

#### Scenario: Address owner after a legacy upgrade
- **WHEN** a CBSW v1.1 account that had an address owner upgrades to `CryoShieldSmartWallet`, and that address owner signs a user operation
- **THEN** validation fails

### Requirement: Validation safe for public bundlers
Signature validation SHALL do constant work per signature: it reads only `ownerAtIndex(ownerIndex)`, never iterating over owners. It SHALL use no opcode banned by ERC-7562 in validation (including `TIMESTAMP`, `NUMBER`, `BLOCKHASH`, `ORIGIN`, `BASEFEE`, `GASPRICE`). Validation SHALL access only the account's own storage, and only the precompiles `0x02` (SHA-256) and `0x100` (P-256), with webauthn-sol's software fallback where `0x100` is absent. The factory SHALL use no storage.

#### Scenario: Opcode scan
- **WHEN** the Foundry test traces `validateUserOp` for the valid fixture and for each negative fixture
- **THEN** no banned opcode appears in the trace

#### Scenario: Hosted bundler accepts the account
- **WHEN** a sponsored create through our factory is sent to Pimlico on OP Sepolia
- **THEN** it is simulated, accepted and included

### Requirement: Immutable, admin-free account code
`CryoShieldSmartWallet` and `CryoShieldSmartWalletFactory` SHALL have no admin, pause or owner role held by CryoShield. Upgrade authority SHALL remain with each account's own owners, as in CBSW v1.1. The factory SHALL be an unmodified copy of the CBSW v1.1 factory code with our implementation as its immutable, deployed via CREATE2 so that, for a given RP ID, both contracts have the same address on every supported chain. The implementation SHALL add no storage variables: its storage layout SHALL be identical to CBSW v1.1.

#### Scenario: Storage layout unchanged
- **WHEN** `forge inspect` storage layouts of `CryoShieldSmartWallet` and CBSW v1.1 are compared in CI
- **THEN** they are identical

#### Scenario: Deployer has no power over accounts
- **WHEN** the deploying address tries to upgrade, add an owner to, or execute from any account it does not own
- **THEN** the call reverts exactly as for any other non-owner

### Requirement: Legacy account upgrade path
A CBSW v1.1 account SHALL be able to switch to `CryoShieldSmartWallet` with a single owner-signed `upgradeToAndCall(implementation, "")`, keeping its address, owners and vault ownership. After the upgrade, every rule in this capability SHALL apply to it.

#### Scenario: In-place upgrade
- **WHEN** a CBSW v1.1 fixture account with two P-256 owners upgrades through a UV-signed user operation
- **THEN** its address, owners and registry vault are unchanged, and a later UV=0 signature is refused

# Spec Delta

## Purpose
Defines CryoShield's on-chain sponsorship policy: which user operations `CryoShieldPaymaster` pays for, how abuse is bounded, and the guarantees it gives bundlers and users. The policy is enforced in the contract, never by client code or a third-party dashboard.

## ADDED Requirements

### Requirement: On-chain sponsorship policy
`CryoShieldPaymaster` SHALL be an ERC-4337 paymaster for EntryPoint v0.6 (`0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`), and SHALL decide sponsorship only in `validatePaymasterUserOp`, from the user operation and on-chain state. No off-chain signature, server, or third-party policy SHALL be required for sponsorship. The paymaster SHALL be deployed without a proxy, and its code SHALL NOT be upgradeable.

#### Scenario: Any bundler, same policy
- **WHEN** an operation that satisfies every rule in this spec is submitted through any ERC-7562-compliant bundler
- **THEN** the paymaster validates it, and an operation violating any rule is rejected whichever client or bundler submits it

### Requirement: Call allowlist
The paymaster SHALL sponsor an operation only when its `callData` selector is CBSW `execute(address,uint256,bytes)` or `executeBatch((address,uint256,bytes)[])`, it decodes to 1–4 calls, every call has value 0, and every call is one of:
- VaultRegistry v2 `createVault`, `updateVault` or `addLocators`;
- AttestationRegistry `attest`;
- the sender itself with `addOwnerPublicKey(bytes32,bytes32)`.

`executeWithoutChainIdValidation` and every other selector SHALL be refused. The paymaster SHALL decode callData with the same ABI decoding the account uses.

#### Scenario: Allowed vault write
- **WHEN** an attested account submits `execute(registryV2, 0, updateVault(...))` with a valid signature and within limits
- **THEN** the paymaster sponsors it

#### Scenario: Value transfer refused
- **WHEN** any call in the batch has a non-zero value
- **THEN** validation fails and the operation is not sponsored

#### Scenario: Replayable cross-chain path refused
- **WHEN** the callData selector is `executeWithoutChainIdValidation`
- **THEN** validation fails

#### Scenario: Self-call other than addOwnerPublicKey refused
- **WHEN** a call targets the sender with `upgradeToAndCall`, `addOwnerAddress`, `removeOwnerAtIndex` or `removeLastOwner`
- **THEN** validation fails

#### Scenario: Unknown target refused
- **WHEN** a call targets any contract other than VaultRegistry v2, the AttestationRegistry, or the sender
- **THEN** validation fails

### Requirement: Account shape
The paymaster SHALL sponsor only Coinbase Smart Wallet v1.1 accounts whose owners are all 64-byte P-256 public keys. When `initCode` is present, its factory SHALL be the pinned CBSW v1.1 factory and every owner in `createAccount` SHALL be 64 bytes.

#### Scenario: Address owner refused
- **WHEN** the operation's `initCode` lists a 32-byte (address) owner, or the signing `ownerIndex` resolves to an address owner
- **THEN** validation fails

#### Scenario: Foreign factory refused
- **WHEN** `initCode` names any factory other than the pinned CBSW v1.1 factory
- **THEN** validation fails

### Requirement: Hardware tap with user verification
The paymaster SHALL decode the CBSW `SignatureWrapper` and `WebAuthnAuth` from `userOp.signature` and require all of:
- `authenticatorData` is at least 37 bytes;
- the flags have both UP (0x01) and UV (0x04) set;
- `authenticatorData[0:32]` equals the immutable `RP_ID_HASH = sha256("cryoshield.app")`;
- the signing owner key is attested (see Attested keys only).

#### Scenario: Signature without UV
- **WHEN** a correctly signed operation's authenticator data has UV = 0 (for example, a stolen key used without its PIN)
- **THEN** validation fails and the operation is not sponsored

#### Scenario: Credential for another RP
- **WHEN** the authenticator data's rpIdHash is not `sha256("cryoshield.app")`
- **THEN** validation fails

### Requirement: Attested keys only
The paymaster SHALL sponsor an operation only when every owner of the account, every `initCode` owner, and every key added by an `addOwnerPublicKey` call is hardware-attested in the AttestationRegistry (`hardware-attestation` capability). An exception is a key whose attestation is supplied by an `attest(sender, inputs)` call in the same operation: when `paymasterAndData` sets `attestMode = 1`, the paymaster SHALL verify those inputs during validation with the registry's read-only `verify` and treat the keys they cover as attested.

#### Scenario: Software key refused
- **WHEN** a fresh account whose owners are software-generated P-256 keys, with no valid attestation, submits a `createVault`
- **THEN** validation fails and nothing is sponsored

#### Scenario: First operation attests and creates
- **WHEN** a new account's first operation is `executeBatch[attest(account, [att1, att2]), createVault(...)]` with `attestMode = 1`, and both attestations verify against pinned roots
- **THEN** the paymaster sponsors it, and after execution both keys and the account are recorded as attested

#### Scenario: Unattested key added
- **WHEN** an attested account submits `addOwnerPublicKey(x, y)` for a key that is neither attested nor attested in the same operation
- **THEN** validation fails

### Requirement: Rate limits and budget
The paymaster SHALL enforce, per period of `PERIOD` seconds (default 86,400):
- at most `maxOpsPerSenderPerPeriod` sponsored operations per sender;
- at most `maxOpsPerSenderLifetime` per sender in total;
- at most `maxAppendsPerLocatorPerPeriod` sponsored locator appends (via `createVault` or `addLocators`) per locator;
- a global `budgetPerPeriod` in wei, reduced by a headroom of `maxCostPerOp × BUNDLE_HEADROOM`.

It SHALL also refuse any operation whose `maxCost` exceeds `maxCostPerOp`. Validation SHALL only read counters. `postOp` SHALL increment them and add the actual cost, using the period carried in the context.

#### Scenario: Per-sender cap
- **WHEN** a sender has already had `maxOpsPerSenderPerPeriod` operations sponsored in the current period
- **THEN** its next operation in that period fails validation, and the same operation validates in the next period

#### Scenario: Per-locator cap stops sponsored stuffing
- **WHEN** `maxAppendsPerLocatorPerPeriod` sponsored appends have already targeted a locator in this period, from any senders
- **THEN** a further operation appending to that locator fails validation

#### Scenario: Global budget with headroom
- **WHEN** the period's spent amount plus the operation's `maxCost` would exceed `budgetPerPeriod − maxCostPerOp × BUNDLE_HEADROOM`
- **THEN** validation fails

#### Scenario: Counters advance only on inclusion
- **WHEN** an operation is validated by a bundler but never included
- **THEN** no counter changes

### Requirement: Period without banned opcodes
Validation SHALL NOT use `TIMESTAMP`, `NUMBER` or any other opcode banned by ERC-7562. The client SHALL put the period index in `paymasterAndData` (`paymaster ‖ version 0x01 ‖ uint32 period ‖ uint8 attestMode`). The paymaster SHALL return `validAfter = period × PERIOD` and `validUntil = (period + 1) × PERIOD − 1` in its validation data.

#### Scenario: Stale period
- **WHEN** an operation carries a period that has already ended by the time a bundler includes it
- **THEN** the EntryPoint rejects it as expired, and no counter of the old period is used for a new-period operation

#### Scenario: Malformed paymasterAndData
- **WHEN** `paymasterAndData` has the wrong length or an unknown version byte
- **THEN** validation fails

### Requirement: postOp never reverts
`postOp` SHALL complete without reverting in both `opSucceeded`/`opReverted` and `postOpReverted` modes, SHALL make no external calls, and SHALL use bounded gas covered by the operation's verification gas limit.

#### Scenario: Inner call reverted
- **WHEN** the sponsored operation's inner call reverts (for example `NotVaultOwner`)
- **THEN** `postOp` still records the cost and the counters, and does not revert

#### Scenario: Fuzzed contexts
- **WHEN** `postOp` is fuzzed with arbitrary periods, senders, locator lists of up to 8 per call, and costs up to `maxCostPerOp`
- **THEN** it never reverts

### Requirement: ERC-7562 compliance as a staked paymaster
The paymaster SHALL hold an EntryPoint stake of at least the configured minimum with an unstake delay of at least 86,400 seconds. During validation it SHALL access only:
- its own storage;
- the sender's storage;
- read-only storage of VaultRegistry v2, the AttestationRegistry and the pinned factory;
- the precompiles `0x05` (modexp) and `0x100` (P-256).

#### Scenario: Safe-mode bundler simulation
- **WHEN** representative create, update, add-key and refused operations are simulated by an Alto bundler in safe mode against a local chain
- **THEN** every allowed operation passes ERC-7562 validation, and every refused one fails in paymaster validation, not in a rule violation

### Requirement: Limited owner powers
The paymaster SHALL have an owner that can only:
- deposit, withdraw the deposit, add stake, unlock stake, and withdraw stake;
- set each limit within hard-coded maximum values;
- pause and unpause sponsorship.

The owner SHALL NOT be able to change the allowlist, the pinned addresses, the RP ID hash, or any vault, and SHALL NOT be able to make the paymaster call arbitrary contracts.

#### Scenario: Cap above hard maximum
- **WHEN** the owner sets `budgetPerPeriod` above its hard-coded maximum
- **THEN** the call reverts

#### Scenario: Paused
- **WHEN** sponsorship is paused
- **THEN** every operation fails paymaster validation, and the registries remain fully usable by self-funded callers

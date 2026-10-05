# Proposal: attested, on-chain sponsorship (paymaster v2) and VaultRegistry v2

## Why

The October 2026 audit (`docs/reviews/security-audit-2026-10.md`) left three contract/AA findings open. The founder made fixing them a **mainnet requirement** (2026-10-05):

- **AA-M3:** sponsorship is decided by client code and a Pimlico dashboard policy. Anyone can script fresh Coinbase Smart Wallets with *software* P-256 keys and get them sponsored through the public Pimlico API key.
  - Neither the chain nor Pimlico can tell a YubiKey from a script.
  - The client allowlist (`apps/web/src/account/policy.ts`) only binds honest copies of our app.
  - Per-sender caps are defeated by fresh senders.
- **AA-M1:** our own paymaster can be used to fill a victim's locator to the 16-entry cap ("locator stuffing").
- **AA-M2:** the preflight `eth_call` leaks a pending `createVault` before the signing tap, so the client-chosen `vaultId` can be squatted.
- **AA-H1 (part 2)** is closely related: CBSW v1.1 verifies WebAuthn with `requireUV: false`. It is planned as a sibling change (see design D9). This change adds a defense-in-depth UV check for sponsored operations only.

## What Changes

- **`CryoShieldPaymaster`:** a new on-chain, **staked** ERC-4337 paymaster for EntryPoint v0.6, with a documented v0.7 path. It replaces Pimlico's paymaster; Pimlico (or any ERC-7562 bundler) only bundles. In `validatePaymasterUserOp` it sponsors an operation only when:
  - **The callData is allowlisted.** The callData decodes as CBSW `execute`/`executeBatch` (never `executeWithoutChainIdValidation`, never anything else). Every call has value 0 and targets either VaultRegistry v2 (`createVault`, `updateVault`, `addLocators`), the AttestationRegistry (`attest`), or the account itself (`addOwnerPublicKey` only).
  - **The keys are attested.** The account's owners, and any key being added, are hardware-attested in the AttestationRegistry. A first operation can attest in the same operation (design D4).
  - **The signature is a real hardware tap with PIN.** The signing owner is a 64-byte WebAuthn key that is attested, and the signature's authenticator data has UP=1, UV=1 and `rpIdHash == sha256("cryoshield.app")`.
  - **Limits hold.** Per-account, per-locator and global per-period limits are not exhausted, and the operation's `maxCost` is under the per-op cap.
  - Counters are only *read* during validation and are written in `postOp`, which never reverts. The period index travels in `paymasterAndData` and is bounded by `validAfter`/`validUntil`, because `TIMESTAMP` is banned in validation (ERC-7562).
- **`AttestationRegistry`:** verifies, on-chain and once per key, a WebAuthn **packed** attestation whose certificate chains to pinned Yubico roots (RSA-2048). It binds the attested credential key to a CBSW owner. It stores only `attestedKey[keccak256(x,y)]` and `attestedAccount[account]`. There is no backend and no ZK prover.
- **`VaultRegistry` v2:** a new immutable deployment. v1 stays readable forever. v2:
  - derives `vaultId = keccak256(abi.encode(msg.sender, salt))` on-chain, so squatting is impossible (AA-M2);
  - drops the 16-entry per-locator cap and adds paginated `resolveLocator(locator, start, count)` plus `locatorLength(locator)` (AA-M1);
  - keeps every other v1 rule.
- **Clients:**
  - The web app enrolls with `attestation: "direct"`, builds `paymasterAndData` itself, writes to v2, and reads v1 and v2.
  - The recovery tool reads both registries.
  - Testnet migration means redeploying, updating the app config, and re-creating the founder's test vault.
- **Docs:** `apps/web/docs/paymaster-policy.md` is rewritten for the on-chain policy, and the system design and threat model are updated.

**Out of scope:**
- The account-level UV/rpId validator, a CBSW v1.1 subclass upgrade (AA-H1 part 2). That is the sibling change `cbsw-uv-enforcing-implementation`, also a mainnet gate (design D9).
- The mainnet deployment itself, which needs a funded stake and the founder's approval.
- A ZK attestation proof, enterprise attestation, and FIDO MDS3 JWT verification on-chain.
- Switching account type (Kernel/Safe, EntryPoint v0.7).
- Sponsorship for non-Yubico vendors, unless the founder adds their roots (open question Q5).
- Any change to the vault blob format, except recording how `vaultId` is derived (with a test vector).

**Runtime dependencies:**
- **Added (all on-chain and public):** the paymaster, the AttestationRegistry and VaultRegistry v2.
- **Removed:** the Pimlico *paymaster* (and its dashboard policy) leaves the trust path. The Pimlico *bundler* stays, and is replaceable by any ERC-7562 bundler.

There is **no CryoShield-operated backend**. The paymaster owner key only manages the paymaster's deposit, stake, caps and attestation denylist. It has no power over any vault.

## Capabilities

### New Capabilities
- `sponsored-gas-paymaster`: the on-chain sponsorship policy (allowlist, attestation gate, UV gate, rate limits, budget, staking, ERC-7562 compliance, admin limits).
- `hardware-attestation`: on-chain verification of FIDO packed attestation against pinned roots, binding to account owners, revocation.

### Modified Capabilities
- `vault-registry`: on-chain `vaultId` derivation, no per-locator cap with paginated resolution, and v1/v2 coexistence.
- `deployment-targets`: per-chain deployment records cover several contracts (registry v1/v2, paymaster, attestation registry).

## Impact

- **contracts/:**
  - `src/VaultRegistryV2.sol`, `src/CryoShieldPaymaster.sol`, `src/AttestationRegistry.sol` and their libraries (DER/X.509 subset, CBOR subset, RSA PKCS#1 v1.5);
  - tests (unit, fuzz, invariant, ERC-7562 simulation against a local Alto bundler);
  - deploy scripts and records.
- **apps/web:**
  - `src/account/` (paymasterAndData builder, the bundler-only client, attestation capture at enrollment);
  - `src/chain/registry.ts` (v1+v2 reads, pagination);
  - the write flows (salt instead of vaultId);
  - docs.
- **packages/vault-crypto:** a `vaultId` derivation test vector, and spec text in `docs/spec/vault-format-v1.md` (the derivation only; the blob is unchanged).
- **tools/recover:** reads v1 and v2 registries, with pagination.
- **Ops:** stake (spec default 1 ETH, 1-day unstake delay; unverified for Pimlico) and a gas deposit per chain. The paymaster owner key is the founder's hardware-backed key (Q3).
- **Costs:** the first operation verifies two attestations (about 0.5–1.2M extra gas, estimated). Later operations add about 40–80k gas of paymaster overhead. On OP Mainnet this is cents or less (design D10).

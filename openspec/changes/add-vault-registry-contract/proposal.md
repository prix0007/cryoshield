# Proposal

## Why

CryoShield needs a permanent, public, company-independent home for encrypted vault blobs. Until an on-chain registry exists, nothing can be stored or recovered, and every other MVP track depends on it: the web app, the desktop recovery tool, and the Arweave mirror. This is PRD Phase 2 and can be built in parallel with the vault crypto core.

## What Changes

- Add an immutable Solidity `VaultRegistry` contract (Foundry project), deployed first to Arbitrum Sepolia, then Arbitrum One. It must stay bytecode-portable to Ethereum L1.
- Add write functions:
  - create a vault: a client-chosen unique `vaultId` (random, or `keccak256(owner, nonce)`), an opaque blob of at most 1024 bytes, and the initial locators;
  - update the vault blob (owner only);
  - add locators (owner only).
- The vault owner is the caller (`msg.sender`). In the default flow, that is the user's ERC-4337 passkey smart account.
- Add read functions usable through plain `eth_call` on any public RPC:
  - fetch a vault by `vaultId`;
  - resolve a locator to its list of candidate `vaultId`s. Locators form an append-only, non-exclusive index capped at 16 entries each. A front-runner cannot claim a locator or remove an existing entry. They can, however, grief a *pending* registration: by filling the victim's locators to the 16-entry cap first, they make that registration revert with `LocatorFull`. The attack needs mempool visibility and a few cents. The only impact is griefing; no secret is ever exposed. The client recovers by enrolling a fresh credential, and writes go through a private bundler endpoint (see design.md, Threat / Abuse Analysis).
- Emit `VaultCreated` and `VaultUpdated` events carrying `vaultId` and `keccak256(blob)`, so the Arweave mirror and the L1 hash anchor can follow later.
- Enforce bounded writes: blob size cap, a cap on locators per vault, 16 entries per locator, one vault per `vaultId`, one vault per owner, and no removal or overwrite of index entries.
- **No upgradeability, no admin or owner role, no pause, no self-destruct.** CryoShield cannot alter, freeze, or delete any vault once deployed.

Out of scope:
- The paymaster and bundler configuration, and smart-account deployment or ownership.
- The vault blob format and locator derivation (owned by the `vault-crypto` capability).
- The Arweave mirror and the Ethereum L1 hash anchor.
- Removing or revoking locators, and transferring vault ownership.
- Frontend and recovery-tool integration.
- A mainnet deployment runbook beyond a testnet deploy script.

Runtime dependencies: none added. Reads use any public Arbitrum RPC. Writes arrive through the third-party ERC-4337 bundler/paymaster allowed by project constraints. **This is not a CryoShield-operated backend.**

## Capabilities

### New Capabilities
- `vault-registry`: on-chain storage, ownership, lookup, and change events for encrypted vault blobs. Covers write rules, size limits, locator resolution, and immutability guarantees.

### Modified Capabilities
- None.

## Impact

- **New code:** `contracts/` Foundry project (contract, tests, deploy script), compiled with a pinned Solidity version.
- **New public interface:** the contract ABI. It becomes a shared contract with the web app, the desktop recovery tool, and the mirror/anchor work.
- **Gas:** each vault write costs CryoShield sponsored gas. Write paths are bounded so paymaster cost per operation is predictable.
- **Coordination:** the sibling `vault-crypto` change. A locator is a 32-byte HKDF output from a key's single-tap PRF. `vaultId` is chosen independently of locators. The blob is opaque bytes, and the client tries each candidate vault and keeps the one that decrypts.

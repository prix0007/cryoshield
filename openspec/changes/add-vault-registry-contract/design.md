# Design

## Context

Greenfield repo: no contracts exist yet. Constraints come from `openspec/config.yaml`:
- no CryoShield backend;
- symmetric crypto, done client-side;
- Arbitrum first, portable to L1;
- open source with no audit, which pushes toward minimal, obviously-correct code.

Writes arrive from ERC-4337 passkey smart accounts via a sponsored paymaster, so `msg.sender` is the smart account. The blob and locator semantics are owned by the sibling `vault-crypto` change. This contract treats them as opaque `bytes` and `bytes32`.

## Goals / Non-Goals

**Goals:**
- The smallest possible immutable contract that fulfils `specs/vault-registry/spec.md`.
- Write cost per call that is bounded and predictable, so it fits a paymaster policy.
- Reads that need only `eth_call`, so the desktop recovery tool works with any RPC.

**Non-Goals:**
- On-chain validation of blob contents or cryptography.
- Vault history in storage: past versions are recoverable only from event hashes plus the Arweave mirror.
- Locator removal and owner transfer: key changes happen at the smart-account level.
- Gas refunds or deposits.

## Decisions

1. **Storage layout:**
   - `mapping(bytes32 vaultId => Vault{address owner; uint32 version; uint8 locatorCount; bytes blob})`
   - `mapping(bytes32 locator => bytes32[] vaultIds)`: append-only, at most 16 entries
   - `mapping(address owner => bytes32 vaultId)`
   
   Storing the blob in contract storage (not calldata or event logs only) is what makes it readable from any full node indefinitely. EIP-4444 history expiry does not affect state.
   *Alternative rejected:* events/calldata only. Cheaper, but it relies on archive nodes after history expiry.

2. **Immutable, non-upgradeable, ownerless contract.** No proxy, no `Ownable`, no `selfdestruct`.
   *Alternative rejected:* UUPS proxy. Fixing bugs later would be possible, but the company could alter vaults, which breaks the core promise. If a bug is found, deploy a new registry and have clients read both. The old one stays readable forever.

3. **Owner = `msg.sender`, with one vault per owner.** This works with any ERC-4337 account and keeps per-account paymaster cost bounded (one create plus bounded updates). The blob holds multiple secrets, so one vault per account is enough for the MVP.

4. **Non-exclusive, append-only locator index; independent `vaultId`.**
   - `resolveLocator` returns every `vaultId` registered under a locator, and the client keeps the one that decrypts.
   - `vaultId` is client-chosen (random 32 bytes, or `keccak256(owner, nonce)`), must be unique, and reverts on collision. A front-run `vaultId` just means retrying with a fresh one.
   - Registration is never exclusive, so seeing a pending operation can't let anyone block a user.
   
   *Alternative rejected:* an exclusive locator→vaultId map. A front-runner who copied a locator from a pending operation could permanently claim it.

5. **Hard caps:** blob 1–1024 bytes; 2–8 locators per vault; 16 vault entries per locator. These bound worst-case write gas and read size, so the paymaster policy can rely on the contract itself.

6. **Locator addition is append-only, with no removal.** Removal would let a compromised owner key hide a vault from other keys. A lost key's locator stays mapped harmlessly, because reading is public anyway.

7. **Custom errors, no strings.** This cuts bytecode and gas, and the errors are stable for clients to decode.

8. **Pinned compiler, standard EVM target.** Pin a specific Solidity 0.8.x release and an EVM version supported by both Arbitrum and L1. Use no `ArbSys` or other precompiles. Deploy through the canonical CREATE2 deterministic deployer so the address can match across chains.

9. **Gas measurement as an acceptance artifact.** Record `forge snapshot` / gas-report figures for create with a 1024-byte blob and 2 locators, update with 1024 bytes, and add one locator. Estimate expected L2 cost at current Arbitrum gas and the L1 equivalent. Ballpark: about 32 storage slots for 1 KB is roughly 700k L2 gas for create. Real numbers come from the snapshot.

## Threat / Abuse Analysis

- **[Paymaster drain via spam vaults]** Anyone can make fresh passkey accounts, and each can create one vault.
  → The contract bounds per-call gas (size and locator caps) and limits each owner to one vault. The paymaster policy (separate change) restricts sponsored calls to this contract address and these three selectors, with per-sender and global daily caps. Caps on the number of updates per owner are left to the paymaster, since the contract has no clock-based rate limit.
- **[Front-running a registration]** A pending user operation reveals `vaultId` and the locators.
  - A copied locator gains the attacker nothing, because the index is non-exclusive and the victim's append still succeeds.
  - A copied `vaultId` only makes the victim's create revert; the client retries with a fresh random `vaultId`.
- **[Locator-list stuffing (spam/DoS)]** Once a victim registers, their locators are public, and an attacker can append junk `vaultId`s under them. The worst case is bounded:
  - **Lookup still works.** The index is append-only, so the victim's existing entry can never be removed or displaced. Resolving the locator still returns it, and junk candidates simply fail to decrypt client-side.
  - **Filling the 16-entry cap only blocks future registrations under that same locator.** That's accepted. The mitigation is to enroll a fresh credential, which produces a new locator.
  - **Each junk entry costs the attacker a vault**, and each owner may hold only one vault, so filling a cap needs about 16 smart accounts. Locators carry no owner, so the paymaster cannot police which locators a caller registers. It only sponsors calls to the VaultRegistry, under per-account and global caps (separate change).
- **[Malicious owner key]** A compromised enrolled key controls the smart account and can overwrite the blob with garbage.
  - Old versions survive via the Arweave mirror and event hashes.
  - Smart-account key management is out of scope here.
- **[Privacy]** Locators, owner, and blob are public. The blob is ciphertext. Locators are HKDF outputs and cannot be linked to the hardware key without its PRF. Write timing and owner address are visible, which is an accepted metadata leak (see PRD risks).
- **[Unaudited code]** Mitigated by:
  - minimal surface (3 writes, 2–3 views);
  - no external calls, so reentrancy is not possible;
  - full branch coverage and fuzz tests on caps and index append-only behaviour;
  - a security-review task before deploy.

## Risks / Trade-offs

- [Bug discovered after deploy, contract can't be patched] → Deploy a v2 registry; clients read both. Keep the code minimal to make this unlikely.
- [One vault per owner is too restrictive later] → A v2 registry can relax it without breaking v1 reads.
- [Storage cost if moved to L1 (~$3/KB normally)] → Accepted. The L1 move is a later, user-paid tier.

## Migration Plan

1. Run the full test suite and the gas snapshot.
2. Deploy to Arbitrum Sepolia through the deterministic deployer and verify the source on the explorer.
3. Publish the address and ABI in the repo.
4. Arbitrum One deployment is gated on the security-review task and is not in this change.

Rollback = stop pointing clients at the address. The deployed contract and its data remain.

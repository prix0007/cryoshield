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
   - Registration is never exclusive, so seeing a pending operation can't let anyone claim a locator or displace a user's entry. A front-runner can still grief a pending registration by filling its locators to the cap (see Threat / Abuse Analysis, Pre-registration locator stuffing).
   
   *Alternative rejected:* an exclusive locator→vaultId map. A front-runner who copied a locator from a pending operation could permanently claim it.

5. **Hard caps:** blob 1–1024 bytes; 2–8 locators per vault; 16 vault entries per locator. These bound worst-case write gas and read size, so the paymaster policy can rely on the contract itself.

6. **Locator addition is append-only, with no removal.** Removal would let a compromised owner key hide a vault from other keys. A lost key's locator stays mapped harmlessly, because reading is public anyway.

7. **Custom errors, no strings.** This cuts bytecode and gas, and the errors are stable for clients to decode.

8. **Pinned compiler, standard EVM target.** Pin a specific Solidity 0.8.x release and an EVM version supported by both Arbitrum and L1. Use no `ArbSys` or other precompiles. Deploy through the canonical CREATE2 deterministic deployer so the address can match across chains.

9. **Gas measurement as an acceptance artifact.** Record `forge snapshot` / gas-report figures for create with a 1024-byte blob and 2 locators, update with 1024 bytes, and add one locator. Estimate expected L2 cost at current Arbitrum gas and the L1 equivalent. Ballpark: about 32 storage slots for 1 KB is roughly 700k L2 gas for create. Real numbers come from the snapshot.

10. **Deployment record.** The deploy flow (`contracts/script/deploy.sh`) writes `contracts/deployments/<chainId>.json` with `{chainId, address, deployBlock, txHash, abiHash}`. `abiHash` is keccak256 of the exact bytes of `contracts/abi/VaultRegistry.json`. Log readers (the recovery tool, the Arweave mirror) start scans at `deployBlock`. A local anvil deploy writes `31337.json` for the web app's E2E tests. Requested by the recovery and frontend engineers through the overwatcher.

## Implementation Notes (as built)

These are choices the spec leaves open. Each is labelled **Assumption** where it is not dictated by the spec.

- **Compiler and EVM:** solc `0.8.28`, `evm_version = cancun`, optimizer 10,000 runs. Cancun is live on Ethereum L1 and on Arbitrum (ArbOS ≥ 20). The mainnet profile (`FOUNDRY_PROFILE=mainnet`: chain id 1, 36M gas limit) produces identical bytecode and passes the full suite.
- **Duplicate-locator detection without extra storage:** before appending, the contract scans the locator's existing list (at most 15 entries) for this `vaultId`. One check covers both "duplicate within one call" and "already on this vault", and avoids a per-vault locator set (about 22k gas per locator). Worst-case scan cost is bounded by the 16-entry cap.
- **`LocatorAdded` is also emitted for the initial locators at creation,** so indexers see every locator through a single event type.
- **All events index `vaultId` as the first topic** (spec: Change events).
- **Assumption:** `addLocators` with an empty list reverts with `TooFewLocators(0)` instead of being a silent no-op.
- **Assumption:** `getVault` on an unknown id returns `(address(0), "", 0)` and does not revert, mirroring `resolveLocator`.
- **Assumption:** `vaultOf(address)` is exposed as a public view (design decision 1 lists the mapping), so a smart account can find its own vault.
- **Assumption:** SPDX license `MIT`. The repo has no LICENSE file yet, so the overwatcher should confirm.
- **Custom errors:** `ZeroVaultId`, `ZeroLocator`, `VaultIdTaken(bytes32)`, `OwnerAlreadyHasVault(address)`, `InvalidBlobSize(uint256)`, `TooFewLocators(uint256)`, `TooManyLocators(uint256)`, `DuplicateLocator(bytes32)`, `LocatorFull(bytes32)`, `NotVaultOwner(bytes32,address)`. The selectors are listed in `contracts/README.md`, and all errors are in the exported ABI.

## Measured Gas

Measured with forge 1.1.0 (`test/Gas.t.sol`, isolated). Figures are full-transaction L2 execution gas, including the 21k intrinsic gas and calldata. Details and USD estimates are in `contracts/GAS.md`.

| Operation | Gas |
|---|---:|
| create: 1024-byte blob, 2 locators | 912,617 |
| update: 1024-byte blob | 212,039 |
| add 1 locator | 74,667 |
| deploy (runtime 3,845 bytes) | 871,075 |

The ballpark in decision 9 (~700k for create) was low by about 30%. The extra cost is the 21k intrinsic gas, about 16k for 1 KB of calldata, the two index appends with their events, and the owner mapping. The estimated cost at 0.01 gwei and ETH = $3,000 is about $0.027 per create on Arbitrum, plus the unmeasured L1 data component. On L1 the same create costs about $2.7 at 1 gwei. The PRD target of ≤ $1 per vault holds on Arbitrum.

## Threat / Abuse Analysis

- **[Paymaster drain via spam vaults]** Anyone can make fresh passkey accounts, and each can create one vault.
  → The contract bounds per-call gas (size and locator caps) and limits each owner to one vault. The paymaster policy (separate change) restricts sponsored calls to this contract address and these three selectors, with per-sender and global daily caps. Caps on the number of updates per owner are left to the paymaster, since the contract has no clock-based rate limit.
- **[Front-running a registration]** A pending user operation reveals `vaultId` and the locators.
  - A copied locator cannot be *claimed*, because the index is non-exclusive, and a single junk append does not stop the victim's append. Filling the locator to the 16-entry cap first *does* make the victim's call revert. See Pre-registration locator stuffing below.
  - A copied `vaultId` only makes the victim's create revert; the client retries with a fresh random `vaultId`.
- **[Locator-list stuffing (spam/DoS)]** Once a victim registers, their locators are public, and an attacker can append junk `vaultId`s under them. The worst case is bounded:
  - **Lookup still works.** The index is append-only, so the victim's existing entry can never be removed or displaced. Resolving the locator still returns it, and junk candidates simply fail to decrypt client-side.
  - **Filling the 16-entry cap only blocks future registrations under that same locator.** That's accepted. The mitigation is to enroll a fresh credential, which produces a new locator.
  - **Each junk entry costs the attacker a vault**, and each owner may hold only one vault, so filling a cap needs 16 owner addresses. Those need not be sponsored smart accounts: one unsponsored transaction to an attacker factory can create 16 throwaway contracts that each create a vault with a 1-byte blob. On Arbitrum that costs only a few cents. Locators carry no owner, so the paymaster cannot police which locators a caller registers. It only sponsors calls to the VaultRegistry, under per-account and global caps (separate change).
- **[Pre-registration locator stuffing (griefing)]** *(security review, MEDIUM; accepted for the MVP by overwatcher decision)* A victim's pending `createVault`/`addLocators` user operation exposes their locators before inclusion. An attacker who watches the mempool can front-run it with the factory transaction above, filling each exposed locator to 16 entries. The victim's call then reverts with `LocatorFull`. This corrects the earlier claim that front-running "cannot block a user".
  - **Preconditions:** visibility of the pending operation (a shared/public mempool) and a few cents of attacker gas per locator set.
  - **Impact: griefing only.** No vault data is altered, no secret or key material is exposed (locators are HKDF outputs and blobs are ciphertext), and no existing entry is displaced. The victim loses the attempt and the sponsored gas for it.
  - **Mitigations (MVP):**
    1. The client handles `LocatorFull` (selector `0xcfe5bd5b`) by enrolling a fresh credential, which yields a new, never-published locator, and retrying. The overwatcher is coordinating this with the frontend.
    2. Writes are submitted through a **private (non-shared-mempool) bundler endpoint**, so pending user operations are not visible to arbitrary watchers.
  - **Residual risk:** a bundler or sequencer insider, or a leak from the private endpoint, can still grief. Repeated griefing costs the attacker a few cents per attempt and the victim a credential re-enrollment.
  - **Post-MVP option: commit-reveal registration.** First commit `keccak256(vaultId, locators, owner, salt)`, then reveal in a later block; reveals are only accepted for a prior commitment, and a short window gives committed locators priority. This hides locators until the commitment is final. The cost is a second transaction and therefore a second user signature (a second hardware-key tap) plus extra sponsored gas. Not adopted for the MVP.
- **[Malicious owner key]** A compromised enrolled key controls the smart account and can overwrite the blob with garbage.
  - Old versions survive via the Arweave mirror and event hashes.
  - Smart-account key management is out of scope here.
- **[Privacy]** Locators, owner, and blob are public. The blob is ciphertext. Locators are HKDF outputs and cannot be linked to the hardware key without its PRF. Write timing and owner address are visible, which is an accepted metadata leak (see PRD risks).
- **[Unaudited code]** Mitigated by:
  - minimal surface (3 writes, 2–3 views);
  - no external calls, so reentrancy is not possible;
  - full branch coverage and fuzz tests on caps and index append-only behaviour;
  - a security-review task before deploy.

### Static analysis (Slither)

`uv tool run --from slither-analyzer slither contracts/ --filter-paths "lib/|test/|script/"` with Slither 0.11.6 ran 102 detectors over 1 contract and reported 1 result:

| Detector | Location | Triage |
|---|---|---|
| `uninitialized-state` (High impact, by detector default) | `VaultRegistry._locatorIndex` (VaultRegistry.sol:46), used in `resolveLocator` and `_appendLocators` | **False positive.** The mapping is written through a storage reference (`bytes32[] storage ids = _locatorIndex[locator]; ids.push(vaultId);`), which Slither does not track as initialization. Mappings need no initialization: an unset key reads as an empty array, which is the specified behaviour for an unknown locator. Covered by `test_resolveLocator_unknownReturnsEmptyList`, `test_create_appendsVaultIdUnderEachLocator`, and `invariant_locatorIndexIsAppendOnlyLog`. No code change. |

No reentrancy, access-control, arbitrary-send, delegatecall, or low-level-call findings: the contract makes no external calls.

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

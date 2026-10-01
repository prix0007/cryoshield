# Tasks

## 1. Project Setup

- [ ] 1.1 Scaffold a Foundry project in `contracts/` with a pinned Solidity 0.8.x compiler and an EVM version supported by both Arbitrum and L1; verify `forge build` succeeds on an empty contract
- [ ] 1.2 Add `forge fmt` and `forge coverage` to the documented dev commands in `contracts/README.md`; verify both run cleanly

## 2. Creation and Uniqueness (test first)

- [ ] 2.1 Write failing tests for successful creation (owner, version 1, `vaultId` appended under each locator), a duplicate or front-run vaultId reverting, a second vault from the same owner, and zero vaultId/locator; verify they fail
- [ ] 2.2 Implement `createVault` with custom errors and the `VaultCreated` event; verify the 2.1 tests pass
- [ ] 2.3 Add a test that the event's blob hash equals `keccak256` of the stored blob; verify it passes

## 3. Limits (test first)

- [ ] 3.1 Write failing tests for an empty blob, a 1025-byte blob, the 1024-byte 0xA5 round-trip vector, fewer than 2 locators, more than 8 locators, and duplicate locators within one call; verify they fail
- [ ] 3.2 Implement the size and locator-count checks; verify the 3.1 tests pass
- [ ] 3.3 Add fuzz tests over blob length (0–2048) and locator count (0–16) asserting accept/reject boundaries; verify `forge test` passes with at least 1,000 runs

## 4. Owner-only Updates and Locator Addition (test first)

- [ ] 4.1 Write failing tests: owner update increments the version by 1 and emits `VaultUpdated` with the correct hash; a non-owner update or add-locator reverts; the deployer has no special power; adding locators respects the cap of 8 per vault and rejects a locator already on this vault; a locator already used by another vault is accepted and appended; verify they fail
- [ ] 4.2 Implement `updateVault` and `addLocators` with events; verify the 4.1 tests pass

## 5. Reads

- [ ] 5.1 Write tests for `getVault` (owner, blob, version) and `resolveLocator` returning every candidate in insertion order, with an unknown locator returning an empty list without reverting; implement the views and verify the tests pass
- [ ] 5.2 Write index tests: a 17th append under one locator reverts; junk appends from other owners never remove or reorder a victim's existing entry; fuzz arbitrary append sequences and assert the list is a prefix-preserving, append-only log; verify they pass
- [ ] 5.3 Add a script-level test that reads a vault via `cast call` against a local anvil node using only a locator; verify it outputs the exact blob

## 6. Immutability and Portability

- [ ] 6.1 Add a test or static check asserting no `selfdestruct`, `delegatecall`, proxy, or privileged role exists in the bytecode or source; verify it passes
- [ ] 6.2 Run the full suite under a mainnet-equivalent EVM configuration; verify all tests pass with no code changes
- [ ] 6.3 Verify `forge coverage` reports 100% line and branch coverage for `VaultRegistry`

## 7. Gas Measurement

- [ ] 7.1 Commit a `forge snapshot` covering create (1024 bytes, 2 locators), update (1024 bytes), and add-locator; document the L2 gas figures and estimated USD cost on Arbitrum and L1 in `contracts/GAS.md`; verify the snapshot check passes in CI

## 8. Testnet Deployment

- [ ] 8.1 Write a deploy script using the canonical CREATE2 deterministic deployer; verify a dry run against anvil yields the predicted address
- [ ] 8.2 Deploy to Arbitrum Sepolia and verify the source on the explorer; record the address and ABI in `contracts/deployments/arbitrum-sepolia.json`; verify a public-RPC `eth_call` read of a test vault returns the expected blob

## 9. Security Review

- [ ] 9.1 Run a security review of the contract (manual review via the security-reviewer agent, plus Slither) covering reentrancy, access control, front-running, locator-list stuffing, caps, and immutability; verify there are no open high or critical findings before any Arbitrum One deployment

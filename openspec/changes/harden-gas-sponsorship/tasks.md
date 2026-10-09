# Tasks

**Owners:**
- **[sol]** solidity-engineer
- **[fe]** frontend-engineer
- **[rec]** recovery-engineer
- **[cry]** crypto-engineer
- **[ow]** overwatcher or founder
- **[sec]** security-reviewer

**TDD:** write each listed test first, see it fail, then implement. Sections match design.md → Phasing. Testnet (OP Sepolia) comes first; nothing is deployed to OP Mainnet before section 8.

## 0. Plan

- [x] 0.1 [sol] Rescope the plan to Pimlico-hardened sponsorship, the CBSW subclass and VaultRegistry v2 (proposal, design, specs, tasks). Verify: `openspec validate harden-gas-sponsorship --strict` and `openspec validate --all --strict`.

## 1. Pimlico facts and testnet settings [ow]

- [ ] 1.1 [ow] In the Pimlico dashboard, confirm and record (with the date) in `apps/web/docs/paymaster-policy.md`:
  - (a) whether an API key can require a sponsorship policy, or be limited to specific policy IDs;
  - (b) whether a policy-less request is refused when the balance is empty and there is no card;
  - (c) how USD limits count testnet operations;
  - (d) the available origin and method restrictions;
  - (e) whether failed or reverted operations count toward the per-sender operation count.

  These answers also serve as the manual checks for the dashboard-only `gas-sponsorship` scenarios (key from another website, policy bypass bounded by the balance, global cap reached).

  Verify: each design R1 UNVERIFIED item is marked confirmed or "not available".
- [ ] 1.2 [ow] Apply the testnet settings from design D2/D3:
  - a chain allowlist of 11155420;
  - 50 operations per sender lifetime;
  - a global daily spend of about 0.05 ETH (in USD) and 500 operations;
  - $0.50 per operation;
  - a dedicated key restricted to the production origin, with bundler + paymaster only and "policy required" if 1.1(a) exists.

  Verify: screenshots or exported settings are referenced in the runbook (no secrets), and `VITE_SPONSORSHIP_POLICY_ID` matches the policy.

## 2. Sponsorship runbook and refusal regression [fe]

- [x] 2.1 [fe] Rewrite `apps/web/docs/paymaster-policy.md` as the runbook required by the `gas-sponsorship` spec:
  - the settings per environment;
  - the confirmed facts from 1.1;
  - the honest abuse bound (design D4);
  - the balance rule;
  - a weekly review checklist;
  - the D6 re-evaluation trigger;
  - the testnet per-sender lockout remedy (design D2).

  Remove the old "10 operations / $0.50 per sender" table. Verify: the docs review in 7.1, and every number matches design D2.
- [x] 2.2 [fe] Write failing tests in `test/account/writes.test.ts`:
  - `createSponsor` always sends `{ sponsorshipPolicyId }`;
  - an insufficient-balance error and a policy-limit error both map to `SPONSORSHIP_REFUSED` with no user operation sent;
  - in `test/config/` (or the existing config test file), loading the configuration with `VITE_SPONSORSHIP_POLICY_ID` missing or invalid throws a configuration error naming the variable.

  Make them pass, with code changes only if a test fails. Verify: `pnpm --filter web test`.
- [x] 2.3 [fe] Update `docs/system-design.md` and the threat-model text to the Pimlico-hardened design, and remove any reference to an own paymaster. Verify: the docs review in 7.1.

## 3. VaultRegistry v2 [cry] [sol] [rec]

- [x] 3.1 [cry] Write a failing TypeScript test first, then add `vaultIdDerivation` cases (owner address, salt, `keccak256(abi.encode(owner, salt))`) to `packages/vault-crypto/test-vectors/v1.json`. Rewrite `docs/spec/vault-format-v1.md` §4.1 (and the locator note in §4) so it covers v1 vaults (client-chosen id, retry on "taken") and v2 vaults (registry-derived id, no retry); the blob bytes and version byte are unchanged. List in the PR the tests that encode the old retry text (`apps/web/test/account/writes.test.ts`, `apps/web/test/ui/flows.test.tsx`, `apps/web/test/ui/motion-ui.test.tsx`, `contracts/test/VaultRegistry.t.sol`), to be updated in 5.2. Verify: the vault-crypto tests fail before and pass after.
- [x] 3.2 [sol] Write failing tests in `contracts/test/VaultRegistryV2.t.sol`:
  - derivation against the vector;
  - squatting impossible;
  - duplicate derived id reverts;
  - no cap (1,000 appends, then a successful registration);
  - page bounds (start ≥ len, count 0, count > 256 clamped);
  - `getVaults` batching: 32 ids succeed, 33 revert;
  - every kept v1 rule (blob 1–1024 bytes, 2–8 locators, duplicates, zero values, one vault per owner, owner-only update and add, events with `vaultId` indexed).

  Verify: the tests fail.
- [x] 3.3 [sol] Implement `contracts/src/VaultRegistryV2.sol`. Verify: 3.2 passes, line and branch coverage is 100%, `test/Immutability.t.sol` is extended to v2, and the ABI is exported to `contracts/abi/VaultRegistryV2.json`.
- [x] 3.4 [sol] Add fuzz and invariant tests: arbitrary sequences keep every locator list append-only and prefix-preserving with no cap, and the pages concatenate to the full list. Verify: 1,000 fuzz runs and the invariants pass.
- [x] 3.5 [sol] Add gas tests for: create 1 KB with 2 locators, update 1 KB, add a locator, a 256-entry page, and `getVaults` of 32 (1 KB blobs; also record the response size). Record them in `contracts/GAS.md`. Verify: `forge snapshot --check`.
- [x] 3.6 [rec] Write failing tests in `tools/recover`:
  - read v2 then v1 with pagination and `getVaults`;
  - v2 only when there is no v1 record;
  - a locator with more than 1,000 entries resolves in pages and `getVaults` batches of at most 32, and the right vault opens;
  - an id present in both registries uses v2's history; if v2 cannot be confirmed, neither copy is current (design D9).

  Done on `feat/harden-gas-sponsorship-recover` (PR #40). The ECC review fixes (design → Implementation notes, recovery tool) add: every v1 copy is checked against v2's history even when no v2 copy was read; resolve has its own budget with a per-RPC, per-locator cap.

  Then implement. Verify: pytest, ruff and `mypy --strict`.

## 4. CryoShieldSmartWallet and factory [sol] [fe]

- [x] 4.1 [fe] Spike: can viem `toCoinbaseSmartAccount` (the pinned version) use a custom factory and address derivation? If not, prototype the design D8 local wrapper. Record the result in design.md D8. Verify: a unit test computes the same counterfactual address as `getAddress` on the committed CBSW v1.1 factory fixture bytecode deployed on anvil with a non-Coinbase implementation address (our factory is the same code, so this needs nothing from 4.5). Task 5.1 repeats the check against the real `CryoShieldSmartWalletFactory`.
- [x] 4.2 [sol] Add CBSW v1.1 as a pinned dependency (`forge install coinbase/smart-wallet@v1.1.0 --no-git`) and fixtures for the real EntryPoint v0.6. Generate WebAuthn fixtures under `contracts/test/fixtures/webauthn/` with a deterministic script: a P-256 test key; UV=1 valid; UV=0, UP=0, foreign rpIdHash and short-authData negatives, each re-signed. Verify: re-running the generator gives no diff.
- [x] 4.3 [sol] Write failing tests in `contracts/test/CryoShieldSmartWallet.t.sol`, one per `smart-account` scenario:
  - UV=0 refused (userOp, `executeWithoutChainIdValidation`, ERC-1271);
  - foreign rpIdHash refused;
  - short authData refused;
  - malformed `signatureData` never validates;
  - valid tap accepted;
  - an address owner refused at `initialize` and at `addOwnerAddress`;
  - 0 owners and 9 owners refused at `initialize`;
  - a 9th `addOwnerPublicKey` refused;
  - an address owner of an upgraded legacy account cannot sign;
  - the in-place upgrade keeps the address, owners and vault;
  - the deployer has no power.

  Verify: the tests fail.
- [x] 4.4 [sol] Write a failing test that traces `validateUserOp` for every fixture and asserts that no ERC-7562 banned opcode appears and that storage access is limited to the account. Verify: the test fails, or is skipped with a reason until 4.5.
- [x] 4.5 [sol] Implement `contracts/src/CryoShieldSmartWallet.sol` (the D7 overrides only) and `contracts/src/CryoShieldSmartWalletFactory.sol`. Verify:
  - 4.3 and 4.4 pass;
  - the `forge inspect ... storageLayout` diff against CBSW v1.1 is empty (CI check), and a test asserts that the ERC-7201 `MultiOwnableStorage` slot constant equals CBSW v1.1's;
  - coverage of the new code is 100%;
  - the ABIs are exported to `contracts/abi/`.
- [x] 4.6 [sol] Add a fuzz test: random authenticatorData flags and rpIdHash bytes are accepted only when UP, UV and the hash all match. Record the gas per validation (old vs new) in `contracts/GAS.md`. Verify: 1,000 runs, and the snapshot check passes.
- [x] 4.7 [sol] Write a deploy script (CREATE2, presets) for VaultRegistry v2 and for the wallet implementation and factory per RP ID (RP ID as an argument; the script can deploy several RP IDs in one run). It writes `contracts.vaultRegistryV2` and `contracts.wallets.<rpId>` per the deployment-targets delta, never a v1 entry on chain 10, and extends `script/test-deploy-args.sh`. Verify: an anvil dry run for `cryoshield.app` and `cryoshield-web-dev.fly.dev` writes one record with both wallet entries matching the chain.

## 5. Web app [fe]

- [x] 5.1 [fe] Write failing tests:
  - new accounts use `contracts.wallets[VITE_RP_ID].factory` from the record;
  - a record with entries for both `cryoshield.app` and `cryoshield-web-dev.fly.dev` lets each build select its own;
  - the build fails only when the build's RP ID has no entry;
  - the counterfactual address matches `CryoShieldSmartWalletFactory.getAddress` on anvil;
  - signing keeps `userVerification: 'required'`.

  Then implement. Verify: unit tests.
- [x] 5.2 [fe] Write failing tests for the salt-based create: the client-computed `vaultId` equals the registry's (vector 3.1), and the `VAULT_ID_TAKEN` retry path is removed. Update `policy.ts` to target v2. Verify: unit tests and `test:int` against the local stack.

  2026-10-08: the code landed in PR #41. The vector check is now mandatory (no skip), and the v1 contract test's retry comment is marked v1-only.
- [x] 5.3 [fe] Write failing tests: reads page v2 then v1 and use `getVaults`, and a v1-only vault still unlocks. Then implement in `src/chain/registry.ts`. Verify: unit tests, `test:int` and `test:e2e`.
- [x] 5.4 [ow] Regenerate the presets from the deployment records (`config/chain-presets.json` consumers). Verify: the parity tests in contracts, web and recover pass.

  Recovery tool: the anvil and op-sepolia presets carry VaultRegistry v2 from `deployments/31337.json` and `11155420.json`; `test_built_in_registry_matches_deployment_records` checks v1 and `contracts.vaultRegistryV2` (PR #40). Ticked at the overwatcher's request; the contracts and web parity checks are verified in their own PRs.

- [x] 5.5 [fe] Follow-up (overwatcher, 2026-10-06): lazy-load the write stack (viem account abstraction, the Pimlico client, `src/account/*`) on the first save instead of in the initial /app chunk. Verify: `/app` initial JS gzip drops by at least 10 KB in `pnpm --filter @cryoshield/web verify-build`, then lower `APP_BASELINE` in `apps/web/scripts/verify-build.mjs` back by the 2 KB raised for this change; unit, `test:int` and `test:e2e` green.

  2026-10-08: `/app` initial JS gzip went from 216,554 B to 200,242 B (e2e), which is 16,312 B less. `APP_BASELINE` drops the 2 KB and a further 12 KB. A failed chunk load shows a retryable "Nothing was saved" message (design → Implementation notes, web).

## 6. Testnet (OP Sepolia only) [ow] [sol] [fe]

- [x] 6.1 [ow] Deploy VaultRegistry v2 and the wallet implementation and factory for **both** `cryoshield.app` and `cryoshield-web-dev.fly.dev` to OP Sepolia with `BROADCAST=1`. Verify: `contracts/deployments/11155420.json` has `contracts.vaultRegistryV2` and both `contracts.wallets.<rpId>` entries, Blockscout verification passes, and both the production and the dev builds (`deploy-dev.yml`) succeed.
  - [x] 2026-10-07: deployed and Blockscout-verified (registry v2 `0xA622…cB7`; wallet pairs for both RP IDs). Dev deploy succeeded; the `/architecture` page now names registry v2, the account implementation and the v2 vault limits.
  - [x] [fe] Web part (2026-10-07): both builds pass against the real `contracts/deployments/11155420.json` (2ad376c), production mode with stub env values: `VITE_RP_ID=cryoshield.app` (`verify-build`, `VERIFY_CHAIN_ID=11155420`) and `VITE_RP_ID=cryoshield-web-dev.fly.dev` (`vite build --mode production`). Each bundle and `/architecture` carry registry v2 `0xA622…cB7` and only their own RP ID's factory (`0x775d…DfED` / `0x5945…73d3`).
- [ ] 6.2 [sol] Through the hosted Pimlico OP Sepolia endpoint with the testnet policy, run: a sponsored create via our factory, an edit and an add-key, plus a UV=0 operation that must be refused in simulation. Verify: three included operations with receipts, and the refusal recorded.
- [ ] 6.3 [fe] Run the hardware checklist (`apps/web/docs/hardware-test.md`) with two real YubiKeys: create, unlock, edit, add-key, the old v1 vault still unlocking, and recovery-tool reads of v1 and v2. Record the measured gas and cost per operation in `contracts/GAS.md` and `apps/web/docs/costs.md`, and re-check the D2 per-operation caps against them. Verify: the checklist is recorded.
- [x] 6.4 [ow] Re-create the founder's test vault on v2 under a new account. Verify: it unlocks in the app and in the recovery tool. Done by the founder, 2026-10-10.

## 7. Security review [sec]

- [x] 7.1 [sec] Security review of sections 1–6. Check:
  - the UV and rpIdHash override binding on every validation path (userOp, replayable path, ERC-1271);
  - the owner guards and that the constructor still deploys;
  - the storage-layout equality;
  - the banned-opcode trace;
  - factory equivalence with CBSW v1.1;
  - the legacy upgrade path;
  - registry v2 immutability, derivation and pagination bounds;
  - the honesty of the sponsorship runbook and threat model (D4);
  - that the API key and policy settings match design D2/D3;
  - that no CryoShield server or admin key was introduced.

  Record it in `docs/reviews/harden-gas-sponsorship.md`. Verify: no open CRITICAL or HIGH findings.

  2026-10-08: recorded in `docs/reviews/harden-gas-sponsorship.md`. No open CRITICAL or HIGH; APPROVE for OP Sepolia, not a mainnet approval. Open MEDIUMs and owner/hardware tasks (1.1, 1.2, 6.2–6.4, 8.x) are listed there.
  Contracts/CI follow-ups from the review, done on `ci/contracts-review-followups` (design.md, Implementation notes): C3 and C4 (all spec-named checks and the ERC-7562 traces now run in CI), W2 (on-chain record check: OP Sepolia passes all 40 checks), C6 (`GAS.md` generated from the snapshots and checked in CI), C8 (RP ID label rule, no glob expansion), and C9 (fail-closed mainnet gate for every non-testnet preset). Still open: C10 (wording only).

## 8. Mainnet gate [ow]

- [ ] 8.1 [ow] Founder approval to deploy to OP Mainnet, recorded in design.md. Preconditions:
  - 7.1 is clean;
  - 6.2 and 6.3 passed;
  - the mainnet Pimlico policy is set to design D2 (a $20/day global cap, $0.10 per operation, 50 operations and $1.00 per sender per month (design D2; corrected from "lifetime" at the 7.1 review));
  - the mainnet key is restricted per D3;
  - the account is prepaid at about $140 with no card;
  - the D6 trigger is reviewed against the testnet usage data.

  Verify: the approval and the dashboard settings date are in design.md. Only after this may the deploy script target chain 10. The founder's funding of the mainnet deployer does not by itself open the gate.
- [ ] 8.2 [ow] After 8.1, deploy to OP Mainnet **only** VaultRegistry v2 and the `cryoshield.app` wallet implementation and factory. **VaultRegistry v1 is NOT deployed to mainnet**, and neither is the dev RP ID's pair. Verify: `contracts/deployments/10.json` has no top-level v1 address, only `contracts.vaultRegistryV2` and `contracts.wallets["cryoshield.app"]`; Blockscout verification passes; the bytecode-parity check passes.

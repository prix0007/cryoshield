# Tasks

**Owners:**
- **[sol]** solidity-engineer
- **[fe]** frontend-engineer
- **[rec]** recovery-engineer
- **[cry]** crypto-engineer
- **[ow]** overwatcher or founder
- **[sec]** security-reviewer

**TDD:** write each listed test first, see it fail, then implement. Each phase is its own PR. Phases follow design.md → Phasing.

## 0. Plan

- [x] 0.1 [sol] Write proposal, design (with sources), specs and tasks for this change. Verify: `openspec validate paymaster-v2-attested-sponsorship --strict`.
- [ ] 0.2 [ow] Founder answers design.md Q1–Q7. Record the answers in design.md (Decisions) before phase 2 starts. Verify: each answer is recorded in design.md and any spec impact is applied through `/opsx:update`.

## 1. VaultRegistry v2 [sol] [cry] [rec]

- [ ] 1.1 [cry] Add `vaultIdDerivation` cases (owner address, salt, `keccak256(abi.encode(owner, salt))`) to `packages/vault-crypto/test-vectors/v1.json` and the derivation text to `docs/spec/vault-format-v1.md`. Write the TypeScript test first. Verify: the vault-crypto tests fail before and pass after the vectors are added.
- [ ] 1.2 [sol] Write failing tests in `contracts/test/VaultRegistryV2.t.sol`:
  - derivation (against the vector);
  - squatting impossible;
  - the same caller and salt reverts;
  - no cap: 1,000 appends, then a successful registration;
  - pagination bounds (start ≥ len, count 0, count > 256 clamped);
  - `getVaults` batching;
  - every v1 rule kept (blob size, 2–8 locators, duplicates, zero values, one vault per owner, owner-only, events with `vaultId` indexed).

  Verify: the tests fail.
- [ ] 1.3 [sol] Implement `src/VaultRegistryV2.sol`. Verify: 1.2 passes, coverage is 100% lines/branches, and the immutability static check from v1 is extended to v2.
- [ ] 1.4 [sol] Add a fuzz test and an invariant test: arbitrary sequences keep every locator list append-only and prefix-preserving with no cap, and the paginated pages concatenate to the full list. Verify: 1,000 fuzz runs and the invariants pass.
- [ ] 1.5 [sol] Write a gas test: create 1 KB with 2 locators, update 1 KB, add a locator, and resolve a 256-entry page. Record the results in `contracts/GAS.md`. Verify: `forge snapshot --check`.
- [ ] 1.6 [rec] Write failing tests for reading v2 then v1 with pagination and `getVaults`, and for using only v2 when there is no v1 entry. Implement them in `tools/recover`. Verify: pytest, ruff and `mypy --strict`.

## 2. CryoShieldPaymaster core [sol]

- [ ] 2.1 [sol] Fork-free fixtures: deploy the real EntryPoint v0.6 and CBSW v1.1 factory and implementation bytecode in Foundry, as the audit's AA-H1 proof did. Use a `MockAttestationRegistry` with settable `isKeyAttested` and `verify`. Verify: a fixture smoke test passes.
- [ ] 2.2 [sol] Write failing allowlist tests in `CryoShieldPaymaster.t.sol` for each Call allowlist scenario:
  - `execute`/`executeBatch` allowed;
  - `executeWithoutChainIdValidation` refused;
  - value ≠ 0 refused;
  - unknown target refused;
  - self `upgradeToAndCall`, `addOwnerAddress`, `removeOwnerAtIndex` and `removeLastOwner` refused;
  - more than 4 calls refused;
  - malformed calldata refused.

  Verify: the tests fail.
- [ ] 2.3 [sol] Write failing tests for account shape and the signature gate:
  - an address owner in initCode or at the signing index is refused;
  - a foreign factory is refused;
  - UV=0 is refused;
  - UP=0 is refused;
  - a wrong rpIdHash is refused;
  - authenticatorData shorter than 37 bytes is refused;
  - signatures produced through the real CBSW encoding are accepted.

  Verify: the tests fail.
- [ ] 2.4 [sol] Write failing tests for the attestation gate: an unattested owner is refused; an unattested `addOwnerPublicKey` key is refused; `attestMode=1` with an `attest` call whose `verify` succeeds is accepted, and with one that fails is refused. Verify: the tests fail.
- [ ] 2.5 [sol] Write failing tests for limits:
  - per-sender per period, lifetime, per-locator per period, and the global budget with headroom;
  - the `maxCost` cap;
  - `validAfter`/`validUntil` equal to the period bounds;
  - malformed `paymasterAndData` and an unknown version refused;
  - counters unchanged when an operation is not included.

  Verify: the tests fail.
- [ ] 2.6 [sol] Write failing tests for `postOp`: it never reverts (fuzzed context, modes and costs); the inner-call revert path still records; the gas bound is under the documented constant. Verify: the tests fail.
- [ ] 2.7 [sol] Write failing tests for owner powers: deposit, withdraw, stake, unlock and withdraw stake; caps above the hard maxima revert; pause refuses everything while the registries stay usable self-funded; the owner cannot change the allowlist, the pinned addresses or the RP ID hash. Verify: the tests fail.
- [ ] 2.8 [sol] Implement `src/CryoShieldPaymaster.sol` and `src/lib/SponsorshipPolicy.sol` (the D12 split). Verify: 2.2–2.7 pass, coverage is 100%, and the immutability check confirms no proxy, `delegatecall` or `selfdestruct`.
- [ ] 2.9 [sol] Add an invariant test: across random operation sequences, sponsored operations per sender per period never exceed the cap, `spentWei[period] ≤ budgetPerPeriod + maxCostPerOp × BUNDLE_HEADROOM`, and the paymaster never sponsors a non-allowlisted call. Verify: the invariants pass.

## 3. Hardware attestation [sol] [fe]

- [ ] 3.1 [fe] Capture fixtures. Use real YubiKey 5 registrations (`attestation: "direct"`, credProtect 3, rp `cryoshield.app`) from the founder's keys: at least one key chaining to each Yubico root generation (firmware before and after 5.7.4), and Chrome and Firefox captures. Save them (public data only) to `contracts/test/fixtures/attestation/` with a README stating the device, firmware and browser. Verify: fixture JSON validates against a schema test.
- [ ] 3.2 [sol] Generate synthetic negative fixtures with a test-only RSA root, a script under `contracts/test/fixtures/attestation/gen/`, and committed outputs. Cover one per rejection reason:
  - `fmt` none or self;
  - a non-pinned anchor;
  - a wrong rpIdHash;
  - credProtect below 3;
  - an AAGUID mismatch;
  - CA=true leaf;
  - a wrong OU;
  - an expired or not-yet-valid leaf;
  - tampered sig, authData or clientDataHash.

  Verify: the generator is deterministic (re-run, no diff).
- [ ] 3.3 [sol] Write failing tests for the CBOR subset parser (attestationObject, COSE key, credProtect extension output) and the DER/X.509 subset parser (TBSCertificate fields used), including malformed and truncated input. Verify: the tests fail.
- [ ] 3.4 [sol] Write failing tests for `AttestationRegistry`, one for every hardware-attestation scenario: real fixtures accepted; each negative fixture refused; owner binding for a deployed account and for counterfactual (factory) owners; reused attestation for a non-owner refused; `verify` has no side effects; denylist behaviour; no owner backdoor. Verify: the tests fail.
- [ ] 3.5 [sol] Implement the parsers, RSA PKCS#1 v1.5 (modexp `0x05`), P-256 via `0x100` with an FCL fallback only for non-OP test chains, and `src/AttestationRegistry.sol`. Prefer reusing an audited ASN.1/X.509 library (evaluate Automata `X509Helper`/`Asn1Decode`, and record the choice in design.md). Verify: 3.3 and 3.4 pass, and coverage is at least 95% with every branch of the accept path covered.
- [ ] 3.6 [sol] Write a gas test: `verify` on each real fixture is at most 400,000 gas. Record the result in `contracts/GAS.md`. Verify: the snapshot check passes.
- [ ] 3.7 [sol] Fuzz the parsers with random and mutated fixtures: they never accept a mutated signature or certificate, and never revert with a panic (only named errors). Verify: 10,000 runs.
- [ ] 3.8 [sol] Replace the mock in the paymaster tests with the real AttestationRegistry for end-to-end Foundry tests: the first operation attests and creates in one operation, using real CBSW signatures over a real fixture key. That fixture key is software-generated *and* attested by the synthetic test root, which is pinned only in the test deployment. Verify: the test passes.

## 4. Bundler compatibility [sol]

- [ ] 4.1 [sol] Add `contracts/script/alto-sim.sh`. It starts anvil and a pinned Alto version in safe mode with ERC-7562 tracing, deploys everything, stakes the paymaster, and simulates create (attestMode=1), update, add-key and three refused operations. Verify: the allowed operations are accepted, the refused ones fail in paymaster validation, and no ERC-7562 rule violation is reported, including for the precompiles `0x05` and `0x100`. If anvil lacks the tracer Alto needs, document the gap and move this check to 7.2.
- [ ] 4.2 [sol] Add a deploy script (CREATE2, presets) for VaultRegistry v2, the AttestationRegistry (pinned Yubico anchors from a reviewed JSON) and the paymaster. It must write `contracts.<name>` entries per the deployment-targets delta. Extend `script/test-deploy-args.sh`. Verify: an anvil dry run writes a record whose entries match the chain.

## 5. Web app [fe]

- [ ] 5.1 [fe] Write failing tests: enrollment requests `attestation: "direct"` and keeps `attestationObject` and `clientDataJSON`. A non-packed or anonymized attestation yields the new `KeyError('ATTESTATION_UNAVAILABLE')` with plain-language copy, following the Q1 decision. Verify: unit tests.
- [ ] 5.2 [fe] Write failing tests for the `paymasterAndData` builder (version, period from the current time, attestMode). Replace the ERC-7677 Pimlico paymaster with the on-chain paymaster plus the bundler-only client. Keep the client-side allowlist as an early check, extended with `attest`. Verify: unit tests and `test:int` against the local stack with the paymaster deployed.
- [ ] 5.3 [fe] Write failing tests for the salt-based create: the client-computed `vaultId` equals the registry's (vector 1.1), and the `VAULT_ID_TAKEN` retry path is removed. Reads page v2 then v1. Verify: unit tests, `test:int` and `test:e2e`.
- [ ] 5.4 [fe] Map the new paymaster refusals (limits reached, attestation missing, paused) to allow-listed user messages (WEB-L2). Verify: unit tests.
- [ ] 5.5 [fe] Rewrite `apps/web/docs/paymaster-policy.md`, `docs/system-design.md` and the privacy page text for attestation linkability (Q2). Verify: the docs review in 8.1.

## 6. Config and records [ow]

- [ ] 6.1 [ow] Update `config/chain-presets.json` consumers and the generated presets for the new deployment-record entries. Verify: the parity tests in contracts, web and recover pass.

## 7. Testnet [ow] [sol] [fe]

- [ ] 7.1 [ow] Fund the testnet deployer and paymaster from the faucet. Deploy to OP Sepolia with `BROADCAST=1`, stake the paymaster (default 1 ETH or the bundler's documented minimum) and deposit. Verify: `deployments/11155420.json` entries, Blockscout verification, and `entryPoint.getDepositInfo(paymaster)` shows the stake.
- [ ] 7.2 [sol] Run hosted-Pimlico compatibility on OP Sepolia: submit create (attestMode=1), update and add-key through `VITE_BUNDLER_URL` with our paymaster. Confirm the stake requirement and that safe-mode validation accepts the precompiles. Record the outcome in design.md (D8). Verify: three included operations with receipts.
- [ ] 7.3 [fe] Run the hardware checklist with two real YubiKeys on Chrome, Firefox and Safari (macOS) and Chrome Android: attestation outcome per browser, end-to-end create, unlock, and add-key. Record the measured gas and cost per operation in `contracts/GAS.md` and `apps/web/docs/costs.md`. Verify: the checklist is recorded in `docs/hardware-test.md`.

## 8. Review and gate

- [ ] 8.1 [sec] Security review of phases 1–7. Check:
  - allowlist completeness;
  - signature-gate binding;
  - attestation parser soundness (malformed DER/CBOR, length confusion, OID matching);
  - RSA padding check;
  - owner-binding replay;
  - ERC-7562 compliance;
  - that `postOp` never reverts;
  - limit arithmetic;
  - owner powers;
  - the linkability disclosure;
  - registry v2 immutability.

  Record it in `docs/reviews/paymaster-v2-attested-sponsorship.md`. Verify: no open CRITICAL or HIGH findings.
- [ ] 8.2 [ow] Mainnet gate: this change and `cbsw-uv-enforcing-implementation` (D9) are both reviewed, and the founder approves the stake, deposit, limits and owner key. Verify: the approval is recorded in design.md.

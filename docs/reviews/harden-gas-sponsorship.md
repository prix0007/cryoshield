# Security review: `harden-gas-sponsorship` (task 7.1)

- **Reviewer:** `security-reviewer` (read-only), final pass on merged `main` at `ec3cc62`, 2026-10-08.
- **Change:** `openspec/changes/harden-gas-sponsorship` (proposal, design D1–D9 and its implementation notes, the `gas-sponsorship`, `smart-account`, `vault-registry` and `deployment-targets` deltas, tasks).
- **Closes audit findings:** AA-H1 part 2, AA-M1, AA-M2, AA-M3 (`security-audit-2026-10.md`), with the residuals below.

## Scope

| Area | Code on `main` | Merged in |
|---|---|---|
| Plan | `openspec/changes/harden-gas-sponsorship/` | PR #31 (`7d587e8`) |
| Contracts | `contracts/src/VaultRegistryV2.sol`, `CryoShieldSmartWallet.sol`, `CryoShieldSmartWalletFactory.sol`, vendored `contracts/lib/cbsw-v1.1.0/`, `script/DeployV2.s.sol`, `script/deploy.sh`, `deployments/11155420.json` | PR #36 (`fd76fed`) |
| vaultId vector | `packages/vault-crypto/test-vectors/v1.json` (`vaultIdDerivation`), `docs/spec/vault-format-v1.md` §4.1 | PR #37 (`a0a9253`) |
| Recovery tool, v2 reads | `tools/recover` (`chain.py`, `recover.py`, presets) | PR #40 (`5631c86`) |
| Recovery tool, N registry versions | `tools/recover` (`config.py`, `deployments.py`, `chain.py`) | PR #48 (`d379b8e`, change `recover-registry-versions`; reviewed here only where it carries hgs rules) |
| Web app | `apps/web/src/account/` (`wallet.ts`, `writes.ts`, `policy.ts`, `lazy.ts`, `stack.ts`, `errors.ts`), `src/chain/registry.ts`, `src/config/schema.ts`, `vite-plugins/deployment.ts`, `scripts/verify-build.mjs`, `docs/paymaster-policy.md` | PR #41 (`629cfbb`), PR #46 (`2da09c9`) |

Out of scope: the Pimlico dashboard itself (owner tasks 1.1, 1.2), the live OP Sepolia bundler run and the hardware runs (6.2–6.4), and the mainnet gate (8.x).

## Method

1. Read the whole change and every ECC review on PRs #31, #36, #37, #40, #41, #46 and #48 (each PR's final review was at its merge head, so its advisories reached `main` unless a later PR fixed them).
2. Re-checked every advisory against `main`, citing the file and line that fixes it or still has it.
3. Worked through the task 7.1 checklist on the source, and checked the deployed OP Sepolia contracts read-only (`eth_call`, `eth_getCode`) against the record and the build.
4. Looked for problems that only appear when the pieces run together: the wallet wrapper with the lazy write stack, the nonce pin, v1/v2 reads in both clients, and N registry versions.
5. Ran:
   - `forge test`: 138 passed, 6 skipped (the ERC-7562 tests, which need the tracer). `forge test --mc CryoShieldSmartWalletErc7562Test -vvv`: 6/6 passed. `forge snapshot --mc GasTest --check`, `forge test --mt matchesVaultCryptoVectors`, `check-storage-layout.sh` (identical to CBSW v1.1) and `export-abi.sh --check` all passed. These ran on a scratch copy of `contracts/`.
   - `tools/recover`: `pytest` 858 passed, 5 skipped (opt-in); `ruff` and `mypy --strict` clean.
   - The web unit, integration and E2E suites were **not** re-run here (no `node_modules` in the review worktree). The PRs' CI runs are the evidence for them.

## Threat model summary

| Attacker | Before | After this change |
|---|---|---|
| Stolen key **without** its PIN | Could sign user operations (CBSW `requireUV: false`; AA-H1, proved) | Refused twice: credProtect 3 on the key (`enforce-credprotect-uv`), and the account requires UV=1 and `sha256(rpId)` on every signature path. The U2F/CTAP1 path is closed too, because U2F never sets UV |
| Credential minted for another RP | Accepted by CBSW | Refused (`rpIdHash` pinned per RP ID) |
| Front-runner copying a pending create | Could squat the client-chosen vaultId (AA-M2) | Gets a different id: `vaultId = keccak256(abi.encode(msg.sender, salt))` |
| Locator stuffer | Could fill v1's 16-entry cap and block a registration (AA-M1) | Can only lengthen a paginated scan; readers are bounded per registry and per RPC |
| v1 plant of a v2 vault id | n/a | v2, and with PR #48 the newest built-in registry, is authoritative per id. If it can't be confirmed, no copy is current |
| Sponsorship abuser | Policy chosen by the client; key probably usable without it (AA-M3) | Policy id on every request, with limits in the runbook. Bounded by the global daily cap, and without the policy by the prepaid balance. Abuse can only cause "Saving is paused" |
| CryoShield itself | n/a | Holds no admin, owner or upgrade key on any account, registry or factory |

## Findings

Status: **Fixed** (in the PR and commit named) · **Accepted** (with the rationale) · **Open**.

### Planning rounds (PR #31)

| # | Sev | Finding | Status |
|---|---|---|---|
| P1 | HIGH | Self-built paymaster: add-key could never pass the owner binding | Fixed: own paymaster dropped (founder decision 2026-10-05), PR #31 |
| P2 | HIGH | Self-built paymaster: user-controlled `postOp` gas leads to AA50 and a paymaster ban | Fixed: own paymaster dropped, PR #31 |
| P3 | HIGH | One `walletFactory` per chain breaks either the dev build or the production build | Fixed: `contracts.wallets.<rpId>`, PR #31; deployed for both RP IDs (6.1) |
| P4 | MED | `getVaults` had no bound | Fixed: 32 ids per call, `VaultRegistryV2.sol:108` |
| P5 | MED | A lifetime per-sender cap locks a real user out | Fixed in D2 and the spec (monthly on mainnet). **The task 8.1 checklist still said "lifetime"; corrected in this record's PR** (docs only) |
| P6 | MED | `initialize` cannot call `super` | Fixed in code (`CryoShieldSmartWallet.sol:46-54` re-implements the body). D7 wording still says "calls super" (INFO) |
| P7 | LOW | The required-limits list in the `gas-sponsorship` spec omits the mainnet per-sender spend | Open (LOW, spec text; the starting values and the runbook include it) |
| P8 | — | Other planning advisories (§4.1 text, dependency-availability delta, malformed signature, unreachable scenario, ERC-7201 slot) | Fixed, PR #31 (`24920be` review table) |

### Contracts (PR #36)

| # | Sev | Finding | Status |
|---|---|---|---|
| C1 | MED | After an in-place upgrade, a legacy **address** owner keeps direct `execute`, `upgradeToAndCall` and `removeOwnerAtIndex` with no UV (`MultiOwnable._checkOwner`; `CryoShieldSmartWallet.t.sol:400` asserts it) | **Accepted.** No CryoShield account has an address owner: the factory and `initialize` accept only 64-byte keys, and the app never upgrades legacy accounts (D8). OP Mainnet has no legacy accounts. Fixing it needs a redeploy (`src` is frozen at live CREATE2 addresses). **Rule: never upgrade a legacy account that still has an address owner without removing it in the same batch.** Revisit if the in-place path is ever automated |
| C2 | MED | Deployment recorded before the 6.2/7.1 gates | Accepted. 6.1 is ticked; this review covers the deployed bytecode, which matches the source except at the immutable slots |
| C3 | MED | Spec-named checks not in CI: `check-storage-layout.sh`, `export-abi.sh --check`, `test-deploy-args.sh`, `anvil-e2e.sh` | **Open.** `ci.yml:235-275` runs only build, test, snapshot and Slither. All pass locally. Owner change (`.github/workflows`) |
| C4 | MED | The ERC-7562 trace tests `vm.skip` in CI (no `-vvv` step) | **Open.** 6/6 pass under `-vvv`. Owner change, as C3 |
| C5 | LOW | `vm.skip` fallbacks in the shared-vector test (`VaultRegistryV2.t.sol:66,70`) | Open. The test runs and passes today; a renamed file would silently disable it |
| C6 | LOW | `GAS.md` disagrees with the snapshots (`validateUserOp` 221,950 vs 289,273; the "80k cheaper" text is wrong, the gap is about 12k) | Open. Task 6.3 re-measures and re-checks the D2 caps |
| C7 | LOW | `removeLastOwner` can brick an account, including through the replayable path | Accepted: upstream behaviour, needs a UV signature, and the web allowlist (`policy.ts`) never sends it |
| C8 | LOW | `_checkRpId` accepts `a.-b`; `deploy.sh` loops are open to glob expansion | Open (operator-only input) |
| C9 | LOW | The mainnet gate in `deploy.sh:135` covers only `op_mainnet`; `arbitrum_one` can broadcast | Open. Note: v1 can never be written on chain 10 (`v1_policy`, `deploy.sh:62-69,197`) |
| C10 | LOW | Task 4.2 and the smart-account spec still name `contracts/test/fixtures/webauthn/` and a generator; fixtures are signed in-test with `vm.signP256` | Open (wording; the deviation is recorded in the design's implementation notes) |
| C11 | LOW | `deployments/README.md` still says v2 exists on OP Sepolia "once the owner broadcasts" | Open (stale doc) |
| C12 | LOW | Locator spam can bury a vault many pages deep | Accepted by design (AA-M1 trade-off); readers are bounded and warn |

### vaultId vector (PR #37)

| # | Sev | Finding | Status |
|---|---|---|---|
| V1 | MED | The "Solidity fixture" reference had no file | Fixed: `contracts/test/fixtures/vaultIdDerivation.json` exists, and the Foundry test reads the shared vector (PR #36) |
| V2 | MED | §4.1 did not require `owner == msg.sender` | Accepted: the web pre-checks `vaultIdFor(account, salt)` on-chain before encrypting and stops before any tap if it differs (D8) |
| V3 | MED | Vectors not tied to production code | Fixed: the web vector check is mandatory (`test/account/writes.test.ts`, PR #46) |
| V4 | LOW | Weak "no squatting" test, `assert` in the generator, pycryptodome not hash-pinned | Open (LOW, dev tooling) |

### Recovery tool (PRs #40, #48)

| # | Sev | Finding | Status |
|---|---|---|---|
| R1 | HIGH | A v1 plant became CURRENT when the v2 read returned nothing | Fixed: PR #40 (`19f976e`); every v1 copy is checked against v2's history. Generalised to N versions in PR #48 (`chain.py:757-845`) |
| R2 | HIGH | One slow RPC starves every on-chain read | Fixed: PR #40 (`19f976e`, `a26bc42`); separate resolve and fetch deadlines per registry, plus per-RPC caps (`chain.py:222-230, 394-401`) |
| R3 | HIGH | The id cap cut the tail pages | Fixed: PR #40 (`a26bc42`); cap per locator, ranked from both ends |
| R4 | HIGH | Supplied registries could replace or outrank built-ins (PR #48 local review) | Fixed: PR #48 (`cf79eea`). Supplied registries are read beside the built-ins, never CURRENT or VERIFIED, always contested; their empty history counts as unverifiable (`chain.py:735-755`) |
| R5 | HIGH | A supplied deploy block higher than a built-in's could hide history (PR #48 local review) | Fixed: refused (`config.py:260-267`) |
| R6 | MED | A v1-only copy whose v2 history can't be confirmed opens with only a warning when it has no rival | **Accepted.** It is labelled UNVERIFIABLE, shown "(may be outdated)", and gives a SECURITY warning, so the spec rule ("neither copy current") holds. Arweave is now always searched, so an Arweave rival forces a choice |
| R7 | MED | One 60 s history deadline for the whole session (`chain.py:44, 480-489`) | Open. Junk ids can spend it, which turns genuine vaults UNVERIFIABLE: availability only, with a warning |
| R8 | MED | One RPC's fabricated ids can fill the per-locator cap when the honest id has support 1 (`chain.py:270-291`) | Open. The tool warns and points to `--vault-id` |
| R9 | MED | Secret not wiped if the Arweave re-rank raises | Fixed by restructure (PR #49: chain and Arweave merged before opening, `_open_all` wipes on `BaseException`) |
| R10 | MED/LOW | PR #48 advisories: `MAX_SUPPLIED` counts built-in-equal entries; the rank ignores trust (mitigated: always contested and caveated); a flag silently replaces a file entry; number-flag parsing | Open. Tracked by `recover-registry-versions` task 8.1, whose own record is still to be written |

### Web app (PRs #41, #46)

| # | Sev | Finding | Status |
|---|---|---|---|
| W1 | MED | An empty `resolveLocator` page silently truncates the v2 list (`registry.ts:78`) | **Open.** Availability only: a v1 plant cannot take the place of a dropped v2 id, because every v1 id is checked with `getVaults` against v2 (`registry.ts:140-147`) |
| W2 | MED | The record's factory, implementation and rpIdHash are never checked against the chain (build or smoke) | Open. Checked by hand in this review: on OP Sepolia, `factory.implementation()`, `RP_ID_HASH()` and the runtime bytecode match the record for both RP IDs. Add the check before the mainnet record |
| W3 | MED | The v2 scan per locator has no bound | Accepted by design (D9) |
| W4 | MED | Only `older[0]` was reachable; focus lost on the older/current switch | Fixed by `vault-list-labels-archive` (every v1 vault is listed) |
| W5 | MED | The "Touch your key" prompt shows while the lazy chunk, nonce and blob load (`VaultView.tsx:138,162`) | Open (UX). No tap is wasted, because no WebAuthn request is pending; the chunk always loads before the first key tap (`test/account/lazy-order.test.ts`) |
| W6 | LOW | Counterfactual address from one RPC `getAddress` (`wallet.ts:57-59`); guard ignores `factory`/`factoryData` (`writes.ts:109-112`); a v1 read failure blocks v2 (fails closed); `as unknown` cast; release manifest omits rpIdHash; `ensureMirror` on v1 | Open (LOW). The paymaster policy and the account's own checks are the backstops |
| W7 | LOW | `docs/system-design.md` still said the UV/rpId validator was "planned" | **Fixed in this record's PR** (docs only) |
| W8 | LOW | Lazy-stack comments and test timeouts (#46) | Open (LOW) |

### New in this final pass

| # | Sev | Finding | Status |
|---|---|---|---|
| N1 | LOW | **Cross-chain replay of owner and upgrade operations.** The account address depends only on owners and nonce, and the factory has the same address on every chain for an RP ID. So the same `cryoshield.app` keys give the same account on OP Sepolia and OP Mainnet, and an `executeWithoutChainIdValidation` operation (`addOwnerPublicKey`, `removeOwnerAtIndex`, `removeLastOwner`, `upgradeToAndCall`) signed on one chain replays on the other | Accepted: upstream CBSW behaviour, and each operation still needs a UV signature. The app never builds such operations (no use in `apps/web/src`; not in the sponsorship allowlist; nonce key 0). Mainnet note: keep it that way, or separate the chains' owner sets |
| N2 | INFO | The OP Sepolia wallet pairs predate this review, so any fix to C1 means new addresses | Recorded |

**Combined-behaviour checks that passed:**
- The wallet wrapper with the lazy stack: `getFactoryArgs` is overridden on the account the stack builds, the Coinbase factory is refused, and nonce key 0 is forced (`wallet.ts:55,66`).
- The nonce pin passes the nonce read before the STALE check to `sendUserOperation` (`writes.ts:146, 207-221`).
- The lazy chunk is same-origin under `script-src 'self'` with Trusted Types (`vite-plugins/csp.ts`), and `verify-build.mjs:291-310` keeps the write stack out of the initial `/app` graph.
- The sponsorship context `{ sponsorshipPolicyId }` is on every request (`writes.ts:139`), and a refusal never falls back to an unsponsored send.
- A missing or invalid `VITE_SPONSORSHIP_POLICY_ID` stops the build (`config/schema.ts:64-73`).
- v2 is authoritative per id in both clients, and an unconfirmed v2 never falls back to v1.

### Task 7.1 checklist

- **UV and rpIdHash on every validation path:** pass. One override (`CryoShieldSmartWallet.sol:69-82`) is reached from `validateUserOp`, the replayable path, and ERC-1271 through `replaySafeHash`. It needs a 64-byte owner, authData of at least 37 bytes, an `RP_ID_HASH` match, and UP+UV.
- **Owner guards; the constructor still deploys:** pass. Owners are 1–8 keys of 64 bytes, `addOwnerAddress` always reverts, and `addOwnerPublicKey` is capped at 8.
- **Storage layout:** identical to CBSW v1.1, and the ERC-7201 slot test passes. Not yet in CI (C3).
- **Banned-opcode trace:** passes under `-vvv`, with P-256 stubbed. Not yet in CI (C4). The live bundler run is task 6.2.
- **Factory equivalence:** the vendored v1.1 factory, unchanged except the documented pragma, with our implementation as its immutable. No storage, no admin, atomic initialization.
- **Legacy upgrade path:** passes for P-256 owners. The address-owner residual is C1.
- **Registry v2:** immutable, no admin, derivation matches the shared vector, `getVaults` capped at 32, pages clamped to 256, and `start >= len` gives an empty page.
- **Runbook honesty (D4):** `apps/web/docs/paymaster-policy.md` matches D2/D3 and says plainly that the global cap, and without the policy the balance, is the real bound. **The live settings and the dashboard facts (1.1 a–e) are still "pending"**, so whether a key can require the policy is unconfirmed.
- **No CryoShield server or admin key:** confirmed. Deploys take a keystore only and refuse `DEPLOYER_PRIVATE_KEY`.

## Residual risks

- **AA-M3 is bounded but not closed** until tasks 1.1 and 1.2 record the dashboard facts and live settings. Until a key can require the policy, a script holding the public key may sponsor without it. That is bounded by the prepaid balance (no card) on mainnet and is free on testnet.
- **Legacy address owners (C1)** keep a UV-free direct path after an in-place upgrade. No such account exists; don't create one.
- **CI does not enforce** the storage-layout, ABI, deploy-args, anvil and ERC-7562 checks (C3, C4). Until it does, a later change could break them unnoticed.
- **Recovery availability:** a hostile RPC, a long junk history, or an unconfirmable newest registry can make vaults UNVERIFIABLE or hide them behind the id cap (R6–R8). The user gets a warning, never a silent rollback; `--rpc` with a trusted node and `--vault-id` are the ways out.
- **Cross-chain replay** of owner and upgrade operations (N1).
- **Still unaudited by any third party.** The account is a small subclass of audited CBSW v1.1.

## Open owner and hardware tasks (not part of this review)

- hgs 1.1, 1.2: Pimlico dashboard facts and testnet settings.
- hgs 6.2: sponsored create, edit and add-key through hosted Pimlico on OP Sepolia, plus a refused UV=0 operation.
- hgs 6.3: the two-YubiKey hardware checklist and measured gas (also corrects C6).
- hgs 6.4: re-create the founder's test vault on v2.
- hgs 8.1, 8.2: the mainnet gate and the OP Mainnet deploy. **Not opened by this review.** Before 8.1, also fix or accept C3/C4 in CI, add the W2 on-chain record check, and fix the C9 gate scope.
- `recover-registry-versions` 8.1: its own security-review record.

## Verdict

**APPROVE for OP Sepolia (task 7.1). No open CRITICAL or HIGH.** Every HIGH raised across the review rounds is fixed and was re-verified on `main`. The open items are MEDIUM or below: CI coverage, availability under hostile RPCs, documentation, and one accepted legacy-only residual.

**Not a mainnet approval.** The mainnet gate (8.1) still needs 1.1, 1.2, 6.2 and 6.3, plus the founder's approval.

# Proposal: harden gas sponsorship (Pimlico policy), a UV-enforcing account, and VaultRegistry v2

## Why

The October 2026 audit (`docs/reviews/security-audit-2026-10.md`) left four contract/AA findings open. The founder made fixing them a **mainnet requirement** (2026-10-05):

- **AA-H1 (part 2):** Coinbase Smart Wallet (CBSW) v1.1 verifies WebAuthn with `requireUV: false` and never checks `rpIdHash`. A stolen key used **without its PIN** can sign user operations (proved in Foundry). credProtect level 3 at enrollment (`enforce-credprotect-uv`) closes most of this; the account must also refuse UV=0 signatures itself.
- **AA-M1:** anyone can fill a victim's locator to v1's 16-entry cap ("locator stuffing"), sponsored by us.
- **AA-M2:** the preflight `eth_call` leaks a pending `createVault` before the signing tap, so the client-chosen `vaultId` can be squatted.
- **AA-M3:** sponsorship is decided by client code plus a Pimlico dashboard policy, and the public API key can probably be used without the policy.

The first plan for this PR (`paymaster-v2-attested-sponsorship`) proposed a self-built staked paymaster with on-chain YubiKey attestation. The ECC review found two blocking flaws in it: the add-key flow could never pass the "already an owner" binding, and the user-controlled `postOp` gas could trigger AA50, a bundle revert and a paymaster ban. It also raised nine advisories.

**Founder decision (2026-10-05):** drop the self-built paymaster and attestation. Keep **Pimlico's** verifying paymaster, hardened through its dashboard sponsorship policy and API-key settings. Upgrade the account (Q7 = CBSW upgrade, UV and rpId checks on every operation).

## What Changes

1. **Pimlico sponsorship hardening (configuration and docs; no contract).**
   - Recommended policy limits: a global daily cap, a per-sender lifetime cap and a per-operation cap, for testnet and mainnet (design D2).
   - API-key settings: origin restriction and bundler + paymaster methods only, with a separate key per environment. Pimlico's public docs make `sponsorshipPolicyId` **optional** and document no "policy required" key setting, so the account balance is the hard bound for policy-less abuse (design R1, D3).
   - An honest threat model: per-sender limits do not stop scripted fresh accounts, so the **global cap** (and, for policy-less calls, the **balance**) is the real bound. Abuse can only exhaust the budget ("Saving is paused"); it cannot read or corrupt any vault (D4).
   - A rewritten runbook, `apps/web/docs/paymaster-policy.md`, with the exact dashboard settings and a weekly check.
   - A named re-evaluation trigger for an own paymaster (D6).
2. **A UV-enforcing account (fixes the rest of AA-H1).**
   - `CryoShieldSmartWallet`: a small subclass of CBSW v1.1. It overrides `_isValidSignature` to require the WebAuthn UV flag and `rpIdHash == sha256(rpId)` on every signature (user operations, the replayable `executeWithoutChainIdValidation` path, and ERC-1271).
   - It accepts only P-256 owners, caps the owner set at 8, and does O(1) work per signature in validation, with no banned opcodes.
   - `CryoShieldSmartWalletFactory`: an immutable copy of the CBSW v1.1 factory pointing at that implementation.
   - Existing testnet accounts are re-created. An in-place `upgradeToAndCall` is supported but not automated (D8).
3. **VaultRegistry v2 (fixes AA-M1 and AA-M2).**
   - `vaultId = keccak256(abi.encode(msg.sender, salt))`, derived on-chain, so squatting is impossible.
   - No per-locator cap; paginated `resolveLocator(locator, start, count)`, `locatorLength`, and batched `getVaults`.
   - Every other v1 rule is kept: no admin, append-only, a 1–1024-byte blob, 2–8 locators per vault, one vault per owner, the same events.
   - A `vaultIdDerivation` test vector, and v1 + v2 reads in the web app and the recovery tool.
4. **Deploy to OP Sepolia only.** OP Mainnet stays behind an explicit gate (tasks section 8).

### Not doing (and why)

| Dropped from the first plan | Why |
|---|---|
| `CryoShieldPaymaster` (staked, EntryPoint v0.6) and the `sponsored-gas-paymaster` spec | Founder decision. It had two blocking flaws (add-key binding, AA50 from user-controlled `postOp` gas). It also needed a staked ETH deposit, a new privileged owner key and bundler-reputation risk, for a budget a dashboard cap already bounds. |
| `AttestationRegistry` (on-chain packed attestation, Yubico roots, CBOR/DER/RSA parsers) and the `hardware-attestation` spec | It was only needed to gate the self-built paymaster. It meant unaudited parsers, about 0.5–1.2M extra gas per first operation, browser support gaps (withheld attestation) and public linkability of the user's keys. |
| Staking, the `0x05` modexp precompile allowance, local Alto safe-mode simulation | Only the self-built paymaster needed them. |
| The deployment-targets entries for `paymaster` and `attestationRegistry` | Those contracts no longer exist. The delta is kept but now lists only `vaultRegistryV2`, `walletImplementation` and `walletFactory`. |
| Sponsorship webhooks | They need a server we operate, which `openspec/config.yaml` forbids. |
| The sibling change `cbsw-uv-enforcing-implementation` | Folded into this change (Q7). |

**Old open questions:**
- **Moot:** Q1 (withheld attestation), Q2 (attestation linkability), Q3 (paymaster owner key and stake), Q5 (Yubico, Titan or Feitian roots) and Q6 (two-step attestation bootstrap). None of them apply without attestation and an own paymaster.
- **Superseded:** Q4 (limits) is replaced by the Pimlico limits in design D2.
- **Answered:** Q7 = upgrade CBSW (design D7).

**Advisories from the review:**
- **Moot with the paymaster and attestation:** the TIMESTAMP ban (paymaster), the shared per-locator counter, withheld-attestation users, revocation, and the counterfactual binding.
- **Still relevant and addressed:**
  - the unbounded owner loop (D7: owner cap of 8, O(1) validation);
  - TIMESTAMP and other banned opcodes, now applied to the account (D7);
  - cross-references (this change names only existing files and changes);
  - phase numbering (design phases = tasks sections);
  - deployment-targets (trimmed delta).

### Out of scope

- An own paymaster of any kind (re-evaluation trigger in design D6).
- Webhooks, a proxy server, or anything CryoShield operates.
- Hardware attestation of any kind.
- Moving to EntryPoint v0.7, Kernel or Safe.
- Checking `clientDataJSON.origin` on-chain (design D7 explains why).
- Self-funded saving when sponsorship is refused.
- Any change to the vault blob format. Only the `vaultId` derivation is recorded, with a test vector.
- The OP Mainnet deployment itself, which needs the gate in tasks section 8 and founder approval.

### Runtime dependencies

- **Added:** none off-chain. On-chain: VaultRegistry v2, `CryoShieldSmartWallet` and `CryoShieldSmartWalletFactory`, all immutable, with no admin and deployed by us.
- **Unchanged:** Pimlico's bundler and verifying paymaster (a third-party ERC-4337 provider, which `openspec/config.yaml` allows), public RPCs and Arweave.
- **Removed:** the dependency on Coinbase's deployed CBSW v1.1 factory for new accounts. We deploy the same code with our implementation.
- There is **no CryoShield-operated backend**.

## Capabilities

### New Capabilities
- `gas-sponsorship`: how CryoShield sponsors gas through Pimlico. It covers the mandatory policy, the limits, API-key settings, the balance bound, the honest abuse bound, refusal behaviour, the runbook and the re-evaluation trigger.
- `smart-account`: the UV- and rpId-enforcing account. It covers UV + rpIdHash on every signature, P-256-only owners, the owner cap, ERC-7562-safe validation, the immutable factory, no admin and the upgrade path.

### Modified Capabilities
- `vault-registry`: on-chain `vaultId` derivation, no per-locator cap with paginated reads, and v1/v2 coexistence.
- `deployment-targets`: per-chain deployment records list several contracts (`vaultRegistryV2`, `walletImplementation`, `walletFactory`).

## Impact

- **contracts/:**
  - `src/VaultRegistryV2.sol`, `src/CryoShieldSmartWallet.sol` and `src/CryoShieldSmartWalletFactory.sol`;
  - CBSW v1.1 as a pinned `forge install` dependency;
  - unit, fuzz and invariant tests, with WebAuthn fixtures;
  - deploy scripts, records, ABI exports and `GAS.md`.
- **apps/web:**
  - `src/account/` uses our factory and implementation and keeps UV `required`;
  - `src/chain/registry.ts` reads v1 + v2 with pagination;
  - creates use a salt instead of a vaultId;
  - `docs/paymaster-policy.md` is rewritten as the runbook.
- **packages/vault-crypto:** a `vaultIdDerivation` vector in `test-vectors/v1.json`, and the derivation text in `docs/spec/vault-format-v1.md`.
- **tools/recover:** reads v1 and v2, with pagination. It never signs user operations, so the account change does not affect it.
- **Ops:** the Pimlico dashboard policy and API-key settings per environment, and a small prepaid balance for mainnet (no card overdraft).
- **Costs:** the account adds a few hundred gas per signature (one SHA-256 comparison, one flag check). The registry v2 gas is measured in `contracts/GAS.md`.

# Design: harden gas sponsorship (Pimlico policy), a UV-enforcing account, and VaultRegistry v2

## Context

- **Today:**
  - Writes are CBSW v1.1 user operations on EntryPoint v0.6 (`0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`), built with viem `toCoinbaseSmartAccount` (`apps/web/src/account/account.ts`).
  - They are sponsored by Pimlico's verifying paymaster through ERC-7677 context `{ sponsorshipPolicyId }` (`apps/web/src/account/writes.ts`, `VITE_SPONSORSHIP_POLICY_ID`).
  - The only call restriction is client-side (`apps/web/src/account/policy.ts`).
  - VaultRegistry v1 (`0xB43f58cF17e64B603aE5588a1DD17E96a0849e44` on OP Sepolia, immutable) caps each locator at 16 entries and accepts a client-chosen `vaultId`.
- **Audit findings this change closes:** AA-H1 part 2, AA-M1, AA-M2 and AA-M3 (`docs/reviews/security-audit-2026-10.md`). AA-H1 part 1 (credProtect level 3 at enrollment) shipped in `enforce-credprotect-uv`.
- **Founder decisions (2026-10-05):**
  - Pimlico stays the paymaster: no self-built paymaster and no attestation.
  - Q7: upgrade CBSW with UV and rpId checks on all operations.
  - Fixing these findings is a mainnet requirement.
- **Hard constraints** (`openspec/config.yaml`):
  - no CryoShield backend;
  - recovery without CryoShield;
  - deploy only to OP Sepolia until funded;
  - contracts portable to Arbitrum and L1;
  - no external audit, so rely on audited libraries and test vectors;
  - users never handle gas.

## Goals / Non-Goals

**Goals:**
- Bound what an abuser can cost us, with numbers the founder can set in the dashboard, and say honestly what each limit does and does not stop.
- Every user-operation and ERC-1271 signature an account accepts carries UV=1 and our rpIdHash.
- Locator stuffing can't block a registration (AA-M1), and a `vaultId` can't be squatted (AA-M2).
- Keep everything on-chain immutable and admin-free.

**Non-Goals:**
- Sybil resistance. A script can always make fresh accounts with software passkeys; we bound the money, not the accounts.
- Making abuse impossible. The registry stays permissionless, and anyone who pays their own gas can always write.
- Checking `clientDataJSON.origin` on-chain (D7).

## Research findings (2026-10-05)

### R1. Pimlico (fetched from `docs.pimlico.io` on 2026-10-05)

**Sponsorship policy object** ([object](https://docs.pimlico.io/references/platform/api/sponsorship-policies/object)):
- `limits.global`, `limits.user` (per sender) and `limits.user_operation`, each with a `user_operation_spending` amount. Amounts are in **USD only**, in cents.
- `global` and `user` also take a `maximum_user_operation_count` and a `reset_interval` of `never`, `daily`, `weekly` or `monthly`.
- `chain_ids.allowlist`, `start_time`/`end_time`, and an optional webhook.
- **No target-contract, selector or factory rule is documented.**

**API-key restrictions** ([protect API keys](https://docs.pimlico.io/guides/how-to/security/protect-api-keys)):
- **IP addresses**, **user agents** and **origins** can be restricted.
- Bundler methods, paymaster methods and account APIs can each be enabled or disabled per key.
- The page's third option, a proxy server, is a backend and so is rejected.

**`sponsorshipPolicyId` is optional** ([endpoints](https://docs.pimlico.io/references/paymaster/verifying-paymaster/endpoints)):
- "You can optionally pass in a third parameter, `sponsorshipPolicyId`".
- On success "we deduct from your off-chain Pimlico balance".
- **No documented key setting requires a policy.** So a script holding our public API key can probably ask for sponsorship **without** our policy, and none of the policy limits then apply. This matches audit AA-M3 ("probably").
- **UNVERIFIED (founder to confirm in the dashboard, task 1.1):** whether a key can be restricted to "policy required" or to specific policy IDs, and whether a policy-less request is refused when the account has no balance.

**Billing** ([FAQ](https://docs.pimlico.io/references/paymaster/verifying-paymaster/faqs)):
- The balance is pre-charged at maximum cost (gas limits × max gas price) and the unused part is refunded after about 15 minutes. Signed sponsorships expire after 10 minutes.
- Adding a card unlocks an overdraft of **$10 for individuals**.
- When the balance and overdraft run out, "the sponsor RPC methods will start erroring".
- **There is no low-balance alerting.**

**Testnet** ([common errors](https://docs.pimlico.io/references/paymaster/verifying-paymaster/common-errors)): "Testnet User Operations are free to sponsor". **UNVERIFIED:** how USD policy limits count testnet operations. The founder confirms on the dashboard's usage page (task 1.1). If they count as $0, the operation-count limits are the testnet bound.

**Origin restriction** only binds browsers. Any script can send any `Origin` header. It stops other websites from embedding our key, not scripts.

### R2. CBSW v1.1 internals (read from `coinbase/smart-wallet` tag `v1.1.0`)

**Signature validation.** `_isValidSignature(bytes32, bytes)` is `internal view virtual`. Both `validateUserOp` (including the `executeWithoutChainIdValidation` path) and ERC-1271 `isValidSignature` use it.
- For 64-byte owners it calls `WebAuthn.verify(..., requireUV: false, ...)`.
- With `requireUV: true`, base/webauthn-sol checks flags bit `0x04`; it always checks UP (`0x01`).
- The library does **not** check `rpIdHash` or `origin`, and documents this.

**Owner management.**
- `addOwnerAddress`, `addOwnerPublicKey` and `initialize` are `virtual`, and so is `_addOwnerAtIndex`.
- **The constructor** calls `_initializeOwners([abi.encode(address(0))])` to lock the implementation. So a P-256-only rule placed in `_addOwnerAtIndex` would make the implementation impossible to deploy. The rule must go in `initialize`, `addOwnerAddress` and `addOwnerPublicKey` instead (D7).

**Upgrades.**
- UUPS: `_authorizeUpgrade` is `onlyOwner`.
- `canSkipChainIdValidation` lets `upgradeToAndCall`, and the owner add/remove calls, run through `executeWithoutChainIdValidation`, which is replayable across chains.
- Owners live in ERC-7201 namespaced storage (`MultiOwnableStorage`).

**Factory.**
- The account address is a LibClone ERC-1967 CREATE2 address from (implementation, owners, nonce).
- **A different implementation gives different addresses**, so our factory cannot reproduce Coinbase-factory addresses.
- The factory keeps `implementation` as an immutable and uses no storage, so it stays ERC-7562-safe while unstaked.

## Decisions

**D1. Pimlico stays.** Sponsorship goes through Pimlico's verifying paymaster with a dashboard policy. There is no own paymaster and no webhook.
- *Alternative rejected:* the self-built staked paymaster (proposal, "Not doing").
- *Alternative rejected:* webhooks or a proxy, because both need a server.

**D2. Recommended policy limits.** These are starting points. The founder sets them in the dashboard and may tune them. The runbook (task 2.1) is the record of what is live.

| Limit (Pimlico field) | Testnet (OP Sepolia) | Mainnet (OP Mainnet, at the gate) |
|---|---|---|
| Chain allowlist | 11155420 only | 10 only |
| Per-sender count (`user.maximum_user_operation_count`, `reset_interval: never`) | **50 (lifetime)** | 50 (lifetime) |
| Per-sender spend (`user.user_operation_spending`, `never`) | not set | $1.00 lifetime |
| Per-operation spend (`user_operation.user_operation_spending`) | $0.50 (Sepolia L1 data fees run higher) | **$0.10** |
| Global spend (`global.user_operation_spending`, `daily`) | **USD equal to ~0.05 ETH** at setup; record the rate used | **$20 / day** |
| Global count (`global.maximum_user_operation_count`, `daily`) | 500 | 2,000 |

- **Basis:** the measured creates are about 1.5M gas on anvil (`apps/web/docs/costs.md`), with an OP Mainnet estimate of about $0.004 per create.
  - $0.10 per operation is about 25× that estimate. It allows for gas-price spikes and for Pimlico pre-charging at maximum cost.
  - 50 lifetime operations is far above a real user's need: one create, a few edits, one or two add-key operations.
- **Mainnet balance:** prepaid only. Keep it at about **7 days of global cap ($140)**, and add **no card**, so there is no overdraft (R1). That makes the balance the hard bound when a request skips the policy (D3).

**D3. API-key settings.**
- Use one key per environment (dev, testnet production, mainnet). Never reuse the dev key in production.
- **Origins:** only the environment's own origin, for example `https://cryoshield.app`.
- **Methods:** bundler and paymaster on; account APIs off.
- **Policy required:** enable "policy required" or "policy-ID restriction" **if the dashboard offers it**. It is not in the public docs (R1); the founder confirms this in task 1.1.
  - **If no such setting exists**, a script can sponsor without our policy and drain the **balance**, not just the daily cap. The mitigation is D2's small prepaid balance and no overdraft.
  - That residual risk is the main input to the D6 trigger.

**D4. Threat model (sponsorship).**

| Attacker | Can do | Bounded by | Cannot do |
|---|---|---|---|
| Script making fresh accounts with **software passkeys** through our policy | Sponsored writes until the daily global cap is spent. Per-sender limits don't help, because every account is a new sender. | **Global daily cap** (spend and count). The per-op cap bounds each operation. | Read, change or delete any existing vault. Get a vault's plaintext. Block a registration (v2 has no locator cap). Squat a vaultId (v2 derives it from the sender). |
| Script using our API key **without** the policy (if Pimlico allows it) | Sponsored operations with no policy limits | **The prepaid balance**, with no overdraft (D2). Testnet costs us nothing. | The same as above. |
| A website embedding our key in a browser | Nothing | The origin restriction | n/a |
| A stolen YubiKey **without its PIN** | Nothing, because the account refuses UV=0 (D7) and credProtect 3 refuses to sign without a PIN | n/a | n/a |
| A stolen YubiKey **with its PIN** | Same as today: a full key compromise (it can sign for the account and, with that key's PRF, decrypt). The user re-keys. | Out of scope | n/a |
| Pimlico outage or refusal | No sponsored writes ("Saving is paused") | Existing vaults stay readable and unlockable; recovery needs no CryoShield or Pimlico | Touch any vault |

- **The honest summary:** abuse can only exhaust the sponsorship budget. Users then see "Saving is paused". It cannot read or corrupt any vault, because vault integrity rests on the immutable registry's owner checks and on the ciphertext's vaultId binding (`bind-vault-id-to-ciphertext`).

**D5. Refusal behaviour (existing; no code change).**
- `createSponsor` maps paymaster or policy errors to `WriteError('SPONSORSHIP_REFUSED')` (`apps/web/src/account/writes.ts`).
- The app then shows "Saving is paused right now. Your existing vault is safe; please try again later." (`apps/web/src/ui/strings.ts`, `save.paused`).
- During a **first create** it shows "Nothing was saved. Please try again later." with a Details reference (`improve-write-failure-feedback`).
- There is never an unsponsored fallback. Task 2.2 only adds a regression test that a balance or overdraft error maps to the same code.

**D6. Re-evaluation trigger for an own paymaster.** Re-open the own-paymaster design, in a new change that fixes the review's blocking flaws, when **any** of the following happens:
- **Observed abuse:**
  - the global daily cap is reached on 2 or more days in any 7-day window; or
  - sponsorship that did not use our policy appears in Pimlico usage; or
  - the balance is drained faster than D2 predicts.
- **Mainnet scale:** sustained sponsored spend above $300 a month, or above 1,000 new vaults a month.
- **Pimlico capability:** Pimlico removes or weakens policies, or a key cannot be restricted to the policy and the founder judges the balance bound insufficient.

The founder checks this during the weekly dashboard review (runbook). There is no server to alert.

**D7. `CryoShieldSmartWallet`: a CBSW v1.1 subclass (Q7).**
- **`_isValidSignature` override.** It decodes `SignatureWrapper{ownerIndex, signatureData}` and reads `ownerAtIndex(ownerIndex)` (O(1) and own storage; it never iterates owners).
  - **64-byte owner:** decode `WebAuthnAuth` and require `authenticatorData.length ≥ 37` and `authenticatorData[0:32] == RP_ID_HASH`, then `WebAuthn.verify(..., requireUV: true, ...)`. UP is always checked by the library.
  - **Any other owner** (a 32-byte address owner, which can only exist in an in-place-upgraded legacy account) is treated as an invalid signature.
- **`RP_ID_HASH`** is an `immutable` set in the constructor to `sha256(bytes(rpId))`. It lives in code, not storage, so delegatecalled proxies read it safely.
  - Each RP ID gets its own implementation and factory address. The production RP ID is `cryoshield.app` (`web-hosting`, "Domain bound to the RP ID"); dev and local builds deploy their own.
- **P-256 only.**
  - `initialize` requires 1–8 owners, each exactly 64 bytes, then calls `super`.
  - `addOwnerAddress` always reverts.
  - `addOwnerPublicKey` requires `ownerCount() < MAX_OWNERS` (8, matching the registry's 8 locators per vault).
  - The rules sit there and not in `_addOwnerAtIndex`, because the base constructor locks the implementation with an address(0) owner (R2).
  - **This bounds the only owner loop** (`_initializeOwners` during `initCode`) to 8 iterations.
- **ERC-7562-safe validation.**
  - No `TIMESTAMP`, `NUMBER`, `BLOCKHASH` or other banned opcodes.
  - Storage access is limited to the account's own storage.
  - Precompiles: SHA-256 (`0x02`) and P-256 (`0x100`, with webauthn-sol's FCL fallback where absent).
  - These are the same as today's CBSW validation plus one comparison, and are checked by a test that scans validation traces for banned opcodes.
- **`origin` is not checked on-chain.** Someone holding the key can write any `clientDataJSON` through raw CTAP, so an origin check adds no security against a stolen key. Parsing JSON on-chain costs gas, and the base library documents the same choice. `rpIdHash` is stamped by the authenticator, so pinning it rejects credentials minted for other relying parties.
- **No new storage.** The implementation adds only immutables and constants, so the storage layout is byte-identical to CBSW v1.1. `forge inspect` diff is a test.
- **No admin.** UUPS upgrade authority stays with the account's own owners, as in CBSW. CryoShield holds no key over any account.
- **`CryoShieldSmartWalletFactory`** is CBSW v1.1 factory code with our implementation as its immutable. It is deployed with CREATE2, so it has the same address on every chain for a given RP ID and has no admin.
- *Alternative rejected:* a validator module (Kernel v3, Safe, Rhinestone). It moves to EntryPoint v0.7 and gives new addresses, and none of those validators checks rpIdHash.
- *Alternative rejected:* keep Coinbase's factory and upgrade inside each account's first operation. Every first operation would be validated by v1.1 (UV not enforced), which breaks "every user operation". It is kept only as the in-place path for legacy accounts (D8).

**D8. Migration.**
- **Testnet accounts: re-create.** New vaults go to v2 (D9) under accounts from our factory. The founder's test vault is re-created. v1 vaults stay readable forever, both in the app and in the recovery tool.
- **In-place upgrade.** The implementation is storage-compatible, so a legacy CBSW v1.1 account can `upgradeToAndCall(CryoShieldSmartWallet, "")`. That needs one UV signature, and is replayable across chains, which is safe because the implementation has the same address everywhere.
  - Address owners on such an account stop being able to sign (D7).
  - This is documented and tested in Foundry, but the app does not automate it, because the testnet has no other users.
- **Add-key on new accounts:** `executeBatch[addOwnerPublicKey(x, y), addLocators(vaultId, [l]), updateVault(...)]`, as today. It is now signed with UV and capped at 8 owners.
- **Recovery tool:** it never signs user operations, so the account change does not affect it. It reads v1 and v2 (D9).
- **Web integration risk:** viem `toCoinbaseSmartAccount` may not accept a custom factory. Task 4.1 spikes this first.
  - *Fallback:* a thin local `toSmartAccount` wrapper that reuses CBSW encoding with our factory address and `getAddress`.
  - *Last resort:* the D7 rejected alternative, which needs founder approval.

**D9. VaultRegistry v2** (AA-M1, AA-M2; kept from the first plan, unchanged in substance).
- `createVault(bytes32 salt, bytes blob, bytes32[] locators) returns (bytes32 vaultId)`, with `vaultId = keccak256(abi.encode(msg.sender, salt))`.
  - The client computes the same id from the counterfactual account address before encrypting, because the vaultId is in the AAD.
  - **Test vector:** `packages/vault-crypto/test-vectors/v1.json` gains `vaultIdDerivation` cases (owner, salt, vaultId), checked by the TypeScript, Python and Solidity tests.
- **No per-locator cap:**
  - `locatorLength(locator)`;
  - `resolveLocator(locator, start, count)`, with `count` clamped to 256;
  - `getVaults(bytes32[])` for batched candidate reads.
- **Kept from v1:**
  - append-only, insertion order;
  - 2–8 locators per vault, and a 1–1024-byte blob;
  - one vault per owner, owner-only update and add;
  - the same events with `vaultId` indexed;
  - no admin, no proxy, a deterministic CREATE2 address.
- **Stuffing cost:** each junk entry costs the attacker a whole vault (one owner address per entry), and sponsored stuffing is bounded by D2's global cap. The victim's entry never moves, so stuffing only lengthens a paginated scan.
- **Coexistence:** writers use only v2. Readers query v2, then v1, and treat the candidates as one list. v1 is **never deployed to OP Mainnet**.

## Data flows

**Create (new user):**
1. Enroll two keys (credProtect 3, PRF, UV required); this is unchanged.
2. Compute the account address from `CryoShieldSmartWalletFactory.getAddress(owners, 0)`.
3. Generate a random `salt` and compute `vaultId = keccak256(abi.encode(account, salt))`.
4. Encrypt with the vaultId in the AAD.
5. Build `executeBatch[createVault(salt, blob, locators)]` with our factory's initCode.
6. Get sponsorship from Pimlico with `{ sponsorshipPolicyId }`, then sign with one tap and the PIN (UV=1).
7. The bundler simulates. Our account validation checks UV and rpIdHash, then the operation is included.

**Refused sponsorship:** the app shows `SPONSORSHIP_REFUSED`, and nothing is sent (D5).

**Read and recover:** page `resolveLocator` on v2, then v1; call `getVaults`; keep the candidate that authenticates.

## Phasing (matches the tasks.md sections)

| Phase (tasks section) | Content | Gate |
|---|---|---|
| 0 | This plan | Merged |
| 1 | Pimlico dashboard facts and settings (testnet) | Founder confirms R1's unverified items |
| 2 | Sponsorship runbook and docs; refusal regression test | Docs reviewed |
| 3 | VaultRegistry v2, the vaultId vector, and recovery-tool dual read | Tests green |
| 4 | `CryoShieldSmartWallet` and factory, plus the viem spike | Tests green, layout diff clean |
| 5 | Web app integration (v2 writes, our factory, v1 + v2 reads) | E2E green |
| 6 | OP Sepolia deploy and hardware checklist | Real sponsored create, edit and add-key with two YubiKeys |
| 7 | Security review | No open CRITICAL or HIGH |
| 8 | Mainnet gate | Founder approval |

## Risks / Trade-offs

- **[A policy-less use of the public key]** → R1, D3. The bound is the prepaid balance, and the D6 trigger. This is accepted for testnet, where operations are free, and must be re-confirmed at the mainnet gate.
- **[One script drains the daily cap]** → accepted. It is an availability problem only ("Saving is paused"). Vaults are safe, and recovery doesn't depend on us.
- **[The USD limits don't count testnet operations]** → the count limits are the testnet bound (task 1.1 confirms).
- **[viem lacks custom-factory support]** → D8 fallback.
- **[Unaudited subclass]** → the diff is small (two overrides plus owner guards) on top of audited CBSW v1.1. It gets a full Foundry suite against the real EntryPoint v0.6 bytecode, a storage-layout diff, a fuzz test and a security review.
- **[Pimlico's simulation rejects our factory or implementation]** → it uses the same opcodes, storage and precompiles as CBSW v1.1. Task 6.2 proves it on OP Sepolia early.
- **[v1 remains with its 16-entry cap]** → testnet only; mainnet never sees v1.

## Open questions

None are blocking. The R1 items marked UNVERIFIED are confirmations for the founder (task 1.1), not design choices.

## Security review

Recorded at task 7.1 in `docs/reviews/harden-gas-sponsorship.md`.

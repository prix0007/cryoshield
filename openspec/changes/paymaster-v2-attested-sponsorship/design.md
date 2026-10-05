# Design: attested, on-chain sponsorship (paymaster v2) and VaultRegistry v2

## Context

- **Today:**
  - Writes are Coinbase Smart Wallet (CBSW) v1.1 user operations on EntryPoint v0.6, sponsored by Pimlico's verifying paymaster through an ERC-7677 `sponsorshipPolicyId` (`apps/web/src/account/writes.ts`).
  - The only call restriction is client-side (`policy.ts`). Pimlico's documented policy controls are spend caps (global, per-sender, per-op) and API-key restrictions. **No target/selector rule is documented** (`apps/web/docs/paymaster-policy.md`).
  - VaultRegistry v1 (`0xB43f…9e44`, immutable) caps each locator at 16 entries and accepts a client-chosen `vaultId`.
- **Audit findings this change closes:** AA-M1, AA-M2, AA-M3, and the sponsored-ops part of AA-H1 (`docs/reviews/security-audit-2026-10.md`).
- **Founder decision (2026-10-05):** paymaster hardening is a mainnet requirement.
- **Hard constraints** (`openspec/config.yaml`):
  - no CryoShield backend;
  - symmetric-only vault crypto;
  - recovery without CryoShield;
  - OP Mainnet, with contracts portable to Arbitrum and L1;
  - no external audit, so use audited libraries and test vectors;
  - non-technical users never handle gas.

## Goals / Non-Goals

**Goals:**
- The sponsorship policy lives on-chain and is enforced for every sponsored operation, whichever client or bundler submits it.
- Only accounts whose every owner key is proven hardware-backed (FIDO packed attestation, Yubico roots) are sponsored, and every sponsored signature carries UP=1 and UV=1.
- Abuse is bounded on-chain: per account, per locator, globally per period, and per operation.
- Locator stuffing can't block a registration (AA-M1), and a `vaultId` can't be squatted (AA-M2).
- Bundlers accept it: it is ERC-7562 compliant as a staked paymaster.

**Non-Goals:**
- Making self-funded writes impossible. The registry stays permissionless, so CryoShield can never block a user who pays their own gas.
- One-person-one-account Sybil resistance. Attestation proves hardware, not personhood (D7).
- Fixing AA-H1 for *unsponsored* operations. That is the sibling change (D9).
- Hiding a user's authenticator model and batch from the chain (Q2).

## Research findings (2026-10-05)

Sources are cited inline. **UNVERIFIED** marks a claim that a task must confirm.

### R1. ERC-4337 / ERC-7562 rules for paymasters

**Storage access.** "Associated with address A" means a slot equal to A, or `keccak(A‖x)+n` with n ≤ 128, so a `mapping(address ⇒ …)` keyed by A qualifies ([ERC-7562](https://eips.ethereum.org/EIPS/eip-7562)).
- **Unstaked paymaster:** may touch only the sender's storage and sender-associated slots (STO-010, STO-021). It may not use its own storage, and may not return a context, so it gets no `postOp` (EREP-050).
- **Staked paymaster** may also:
  - read and write its own storage (STO-031), including globally keyed or locator-keyed counters;
  - read and write paymaster-associated slots elsewhere (STO-032);
  - **read any storage** of a non-entity contract (STO-033).
  - **So a locator- or key-hash-keyed lookup is compliant only when the paymaster is staked.**

**Banned opcodes.** `TIMESTAMP`, `NUMBER`, `ORIGIN`, `BASEFEE` and others are banned in validation (OP-011). The time window is expressed through `validAfter`/`validUntil` ([ERC-7562](https://eips.ethereum.org/EIPS/eip-7562); [v0.6 VerifyingPaymaster](https://github.com/eth-infinitism/account-abstraction/blob/v0.6.0/contracts/samples/VerifyingPaymaster.sol)).

**Reputation.**
- A paymaster is BANNED when `opsSeen/10 > opsIncluded + 50` and THROTTLED at `+10`. An entity that fails after passing second validation is banned (GREP-040).
- "Global" state that lets one operation invalidate many others is exactly what these rules punish ([ERC-7562](https://eips.ethereum.org/EIPS/eip-7562)).
- Shared counters therefore need **headroom** (D5).

**`postOp`.**
- **v0.6:** if `postOp` reverts, the EntryPoint calls it again in `postOpReverted` mode. If that also reverts, it raises `FailedOp "AA50"` and the **whole bundle reverts**, so the paymaster gets banned. **`postOp` must never revert** ([v0.6 EntryPoint](https://github.com/eth-infinitism/account-abstraction/blob/v0.6.0/contracts/core/EntryPoint.sol)).
- **v0.7:** called once. A revert rolls back the inner call ([v0.7 IPaymaster](https://github.com/eth-infinitism/account-abstraction/blob/v0.7.0/contracts/interfaces/IPaymaster.sol)).
- In v0.6, `postOp` gas is bounded by `verificationGasLimit`, and the prefund multiplies that limit by 3.

**Ordering.** v0.6 validates every operation in a bundle before executing any, so `postOp`-written limits can overshoot by about one bundle.

**Stake.** The spec has `MIN_UNSTAKE_DELAY` = 86400 s and `MIN_STAKE_VALUE` per chain (about $1000). The reference bundler defaults to 1 ETH and 1 day ([BundlerConfig.ts](https://github.com/eth-infinitism/bundler/blob/main/packages/bundler/src/BundlerConfig.ts)). The Alto CLI defaults to 1 ETH and 1 s ([options.ts](https://github.com/pimlicolabs/alto/blob/main/src/cli/config/options.ts)). **What Pimlico's hosted service requires is UNVERIFIED.**

**Bundler.**
- Pimlico's bundler and paymaster are independent, so you can bring your own paymaster ([FAQ](https://docs.pimlico.io/references/paymaster/verifying-paymaster/faqs)).
- OP Mainnet and OP Sepolia support EntryPoint v0.6, v0.7 and v0.8 ([supported chains](https://docs.pimlico.io/guides/supported-chains)).
- Alto validates ERC-7562 in safe mode via `debug_traceCall` ([self-host](https://docs.pimlico.io/references/bundler/self-host)). **Whether the hosted service runs safe mode is UNVERIFIED.**

**EntryPoint version.** CBSW v1.1 hard-codes EntryPoint v0.6 (`entryPoint()`), so **a v0.7 paymaster cannot sponsor our accounts** ([CoinbaseSmartWallet.sol](https://github.com/coinbase/smart-wallet/blob/v1.1.0/src/CoinbaseSmartWallet.sol)).

**CBSW selectors.**
- `executeWithoutChainIdValidation(bytes[])` uses nonce key 8453, signs over a hash **without the chain ID**, and may call `addOwner*`, `removeOwner*` and `upgradeToAndCall`. A sponsoring paymaster must refuse it, or our deposit pays for cross-chain replays.
- Self-calls pass `onlyOwner` because `msg.sender == address(this)`, so only the exact self-selector `addOwnerPublicKey` may be allowed ([MultiOwnable.sol](https://github.com/coinbase/smart-wallet/blob/v1.1.0/src/MultiOwnable.sol)).

### R2. Hardware attestation

**Packed format.** `attStmt = {alg, sig, x5c}`, with `sig` over `authenticatorData ‖ clientDataHash`. The leaf certificate needs OU "Authenticator Attestation", CA=false, and extension `1.3.6.1.4.1.45724.1.1.4` (AAGUID), which must equal the AAGUID in authData ([WebAuthn L3 §8.2](https://www.w3.org/TR/webauthn-3/#sctn-packed-attestation)).

**Yubico chains are RSA-2048 throughout. Nothing is P-384** (checked with openssl against Yubico's published PEMs):

| Certificate | Key | Validity |
|---|---|---|
| U2F Root CA Serial 457200631 | RSA-2048 | 2014–2050 |
| FIDO Root CA Serial 450203556 | RSA-2048 | 2024–2060 |
| Intermediates "Yubico FIDO Attestation A 1 / B 1 / B2 1" | RSA-2048 | |

- Leaf certificates hold a **P-256** key signed sha256WithRSA. Sources: [CA certs](https://developers.yubico.com/PKI/yubico-ca-certs.txt), [intermediates](https://developers.yubico.com/PKI/yubico-intermediate.pem), [attestation docs](https://developers.yubico.com/U2F/Attestation_and_Metadata/).
- Firmware 5.7.4 and later chains to the new root ([fw 5.7](https://docs.yubico.com/hardware/yubikey/yk-tech-manual/yk5-firmware-5.7.html)). **Exactly which firmware ranges chain where is UNVERIFIED** (task 4.1 collects real fixtures).

**On-chain cost.**
- The attestation `sig` is P-256 through RIP-7212 at `0x100`: about 3,450 gas ([RIP-7212](https://github.com/ethereum/RIPs/blob/master/RIPS/rip-7212.md)). OP has it since Fjord ([OP precompiles](https://specs.optimism.io/protocol/precompiles.html)).
- The leaf certificate's signature is one RSA-2048 modexp with e=65537. That's about 5.5k gas under EIP-2565 and about 33k under EIP-7883 ([2565](https://eips.ethereum.org/EIPS/eip-2565), [7883](https://eips.ethereum.org/EIPS/eip-7883)).
- DER and CBOR parsing dominates. The estimate is **100–300k gas per attestation (UNVERIFIED; task 4.x measures it).**

**Libraries to reuse (none audited for this exact use):**
- Automata on-chain PCCS `X509Helper` / `Asn1Decode` ([repo](https://github.com/automata-network/automata-on-chain-pccs));
- Automata Proof-of-Machinehood, whose README lists YubiKey packed attestation but whose `src/` has no YubiKey verifier ([repo](https://github.com/automata-network/proof-of-machinehood-contracts)).

**FIDO MDS3.**
- It is a JWT signed under GlobalSign R46, and each entry carries `attestationRootCertificates` and `statusReports` (for example `ATTESTATION_KEY_COMPROMISE`) ([MDS3](https://fidoalliance.org/specs/mds/fido-metadata-service-v3.0-ps-20210518.html)).
- Verifying the JWT on-chain is impractical, so we pin roots and keep a denylist (D4).

**Batch attestation.** Chrome replaces any certificate that covers fewer than 100,000 devices ([chromium.org/security-keys](https://www.chromium.org/security-keys/)). Enterprise attestation needs per-RP provisioning through Yubico and browser policy, so it is not usable ([Yubico EA](https://developers.yubico.com/WebAuthn/Concepts/Enterprise_Attestation/Getting_Started.html)).

**Browsers with `attestation: "direct"`:**
- **Chrome** asks the user for consent. If they decline, it returns a fresh self-signed certificate ([chromium](https://www.chromium.org/security-keys/)).
- **Firefox** prompts and offers to anonymize ([bug 1430150](https://bugzilla.mozilla.org/show_bug.cgi?id=1430150)).
- **Safari** returns `fmt: "none"` for passkeys ([Apple forum](https://developer.apple.com/forums/thread/713195)). **Its behaviour for external YubiKeys is UNVERIFIED.**
- **Attestation is not guaranteed in any browser (Q1).**

**Sybil cost.** One physical YubiKey (about $50) can mint **unlimited** validly attested credentials. Attestation raises the attacker's floor from $0 to "owns hardware" and forces a physical tap per signature (D7). It does not cap the number of accounts.

**Other vendors:**
- Google Titan v2 and Feitian have P-256 roots in MDS3 ([Titan](https://www.token2.com/tools/fido2-mds/42b4fb4a286643b29bf76c6669c2e5d3), [Feitian](https://www.token2.com/tools/fido2-mds/ee041bce25e54cdb8f86897fd6418464)). Their PRF support is UNVERIFIED.
- Nitrokey 3 mostly ships without attestation; only the 3A Mini is FIDO certified ([forum](https://support.nitrokey.com/t/attestation-for-nitrokey-3/6016)).
- SoloKeys are not in MDS3 ([issue](https://github.com/solokeys/solo1/issues/565)).

### R3. UV/rpId enforcement

**CBSW v1.1 (`_isValidSignature`, L318-346).** It calls `WebAuthn.verify(..., requireUV: false, ...)`. Neither it nor base/webauthn-sol checks rpIdHash or origin; the library documents this ([CBSW](https://github.com/coinbase/smart-wallet/blob/v1.1.0/src/CoinbaseSmartWallet.sol), [WebAuthn.sol L77-87](https://github.com/base/webauthn-sol/blob/main/src/WebAuthn.sol)).
- CBSW is UUPS, `_authorizeUpgrade` is `onlyOwner`, and it is not modular.
- `_isValidSignature` is `internal view virtual`, so **a small subclass can enforce UV and rpIdHash**.
- Owners live in ERC-7201 namespaced storage, so storage-layout risk is low (to be confirmed with `forge inspect`).

**Alternatives.** Safe passkey signer, Kernel v3 WebAuthnValidator, the Rhinestone WebAuthnValidator and OpenZeppelin `WebAuthn` all enforce UV. **None checks rpIdHash or origin.** All except the Safe 4337 module 0.2.0 are EntryPoint v0.7+ ERC-7579 modules, so switching changes the account address.

**Paymaster-side checks are binding but partial.** The account verifies its P-256 signature over exactly the `authenticatorData` the paymaster decoded, so a mismatch fails the operation. But an attacker with a stolen key can **fund the account and send an unsponsored operation**, for example an `executeWithoutChainIdValidation` owner-add, which bypasses any paymaster rule.

**rpIdHash and origin add little against a stolen key.** The authenticator stamps rpIdHash from the credential's own rpId, and someone holding the key can write any clientDataJSON through raw CTAP. **UV is the only check that matters.** We still pin rpIdHash, because it is cheap and rejects credentials minted for other RPs.

## Decisions

**D1. Components and trust.**

| Component | Mutability | Admin |
|---|---|---|
| VaultRegistry v2 | Immutable | None (same as v1) |
| AttestationRegistry | Immutable code | An owner that can only: add pinned roots or intermediates, and denylist an AAGUID, intermediate or leaf hash (it can never un-attest a vault or touch vault data) |
| CryoShieldPaymaster | Immutable code (no proxy) | An owner that can only: deposit/withdraw/stake/unstake, set caps within hard-coded maxima, pause sponsorship |

- **The paymaster owner never controls vaults.** At worst it stops sponsoring, and users can still self-pay.
- *Alternative rejected:* an upgradeable paymaster. Bugs are fixed by deploying a new paymaster and pointing the app config at it; there is no state worth migrating.

**D2. VaultRegistry v2** (AA-M1, AA-M2).
- `createVault(bytes32 salt, bytes blob, bytes32[] locators) returns (bytes32 vaultId)`, with `vaultId = keccak256(abi.encode(msg.sender, salt))`.
  - The client computes the same id from the counterfactual account address before encrypting. The vaultId is in the AAD (`bind-vault-id-to-ciphertext`).
  - **Test vector:** `packages/vault-crypto/test-vectors/v1.json` gains a `vaultIdDerivation` case (owner, salt, vaultId), checked by TypeScript, Python and Solidity.
  - A copied salt yields a different id for any other sender, so squatting is impossible.
- **No per-locator cap.**
  - `locatorLength(locator)`;
  - `resolveLocator(locator, start, count)`, with `count` ≤ 256 and returning `[start, min(start+count, len))`;
  - `getVaults(bytes32[] ids)`, a batched read so candidate scans cost one RPC call per page.
- **Kept from v1:** append-only, insertion order, 2–8 locators per vault, blob 1–1024 bytes, one vault per owner, owner-only update and add, the same events with `vaultId` indexed, no admin, deterministic CREATE2 address.
- **Stuffing cost.** Each junk entry costs the attacker a vault, so one owner address per entry. Sponsored stuffing is bounded by the per-locator limit (D5); unsponsored stuffing costs about a cent per entry on OP.
  - The victim's existing entry never moves.
  - A *pre*-registration stuff (junk appended before the victim) only lengthens the scan, which is paginated and batched.
  - *Alternative rejected:* keeping the cap with sponsorship-only limits, because self-funded attackers bypass the paymaster.

**D3. CryoShieldPaymaster validation** (EntryPoint v0.6 `validatePaymasterUserOp`). It checks the following in order, and every failure returns `SIG_VALIDATION_FAILED` or reverts with a named error.

1. **`paymasterAndData` format:** `paymaster(20) ‖ version(1) = 0x01 ‖ period(uint32) ‖ attestMode(1)`, with no signature.
   - `period = floor(t / PERIOD)`, with `PERIOD` = 1 day.
   - It returns `validAfter = period·PERIOD` and `validUntil = (period+1)·PERIOD − 1`.
2. **callData allowlist:**
   - selector ∈ {`execute`, `executeBatch`} (`executeWithoutChainIdValidation` is refused);
   - decoded with `abi.decode` on calldata, so the paymaster reads exactly what CBSW executes;
   - 1–4 calls, each with value 0;
   - target and selector ∈ {(registryV2, `createVault` | `updateVault` | `addLocators`), (attestationRegistry, `attest`), (sender, `addOwnerPublicKey`)};
   - the locators in `createVault`/`addLocators` are collected for D5.
3. **`initCode`:**
   - empty, or the pinned CBSW v1.1 factory (`0xba5ed110…`) with `createAccount(owners, nonce)`;
   - every owner must be 64 bytes (a P-256 key); an address owner is refused.
4. **Signature gate** (sponsored AA-H1 defense in depth). It decodes CBSW's `SignatureWrapper{ownerIndex, abi.encode(WebAuthnAuth)}` and requires:
   - `ownerAtIndex(ownerIndex)` (or `owners[ownerIndex]` from initCode) is 64 bytes;
   - `authenticatorData` is at least 37 bytes;
   - `flags & 0x05 == 0x05` (UP and UV);
   - `authenticatorData[0:32] == RP_ID_HASH` (an immutable, `sha256("cryoshield.app")`).

   This binds because the account verifies the P-256 signature over the same bytes. Reading `ownerAtIndex` is sender storage (STO-010).
5. **Attestation gate** (D4). Every current owner, every initCode owner, and every key in an `addOwnerPublicKey` call must satisfy `attestedKey[keccak256(x,y)]`, unless `attestMode = 1` (D4).
6. **Limits** (D5). The relevant counters for `period` are read and checked with headroom. `maxCost` must be ≤ `maxCostPerOp`.
7. **Return:** `context = abi.encode(sender, period, locators)`.

**D4. Attestation: verify once on-chain, at the first sponsored operation.**
- **`AttestationRegistry.attest(account, AttestationInput[])`** is permissionless and pure verification plus writes. For each input it:
  - parses the CBOR attestationObject, requiring `fmt == "packed"`, `alg == -7` and a non-empty `x5c`;
  - checks authData: `rpIdHash == sha256("cryoshield.app")`, the AT flag set, a known AAGUID, the credProtect extension = 3 (`enforce-credprotect-uv`), and a COSE P-256 credential key `(x, y)`;
  - verifies `sig` over `authData ‖ clientDataHash` with the leaf key, through P-256 at `0x100`;
  - parses the leaf certificate (DER subset): it requires OU "Authenticator Attestation", CA=false, the AAGUID extension equal to the authData AAGUID, a validity window covering its creation, the leaf not denylisted, and sha256WithRSA. It checks the signature with RSA PKCS#1 v1.5 (modexp `0x05`) against a **pinned intermediate** (or root), which must not be denylisted;
  - requires `(x, y)` to be an owner of `account`: `isOwnerPublicKey` once deployed, otherwise one of the initCode owners via `factory.getAddress(owners, nonce) == account`;
  - writes `attestedKey[keccak256(x,y)] = aaguid` and emits `KeyAttested(account, keyHash, aaguid, leafHash)`. Once every owner is attested, it sets `attestedAccount[account]`.
- **Bootstrap without a backend or a separate funded transaction.** The first operation is `executeBatch[attest(account, inputs), createVault(...)]` with `attestMode = 1`.
  - In validation the paymaster calls `attestationRegistry.verify(account, inputs)`, a `view` running the same checks without writes. That is read-only use of a non-entity contract plus precompiles (STO-033; OP rules on precompiles in D8).
  - In execution, `attest` writes the result.
  - Validation is simulated off-chain, so a bad attestation costs us nothing; it is never included.
- **Pinned roots.** The deploy pins the Yubico intermediates (A 1, B 1, B2 1) and both roots. New batches chain to pinned intermediates, so no update is needed for them. A new intermediate needs an owner `addTrustAnchor`.
  - *Alternative rejected:* pinning batch leaf keys only. Every batch needs an update, and it loses the AAGUID-from-certificate check.
- **Revocation.** The owner may denylist an intermediate, leaf hash or AAGUID, for example after an MDS3 `ATTESTATION_KEY_COMPROMISE`. A denylisted entry makes `verify` fail. Previously attested keys stay attested unless their leaf or AAGUID is denylisted: `isAttested` re-checks the stored `aaguid` and `leafHash` against the denylist (one or two extra SLOADs).
- **Privacy (Q2).** The calldata permanently shows the model (AAGUID), the batch certificate (≥100k devices) and the binding to the owner keys. That links the user's two keys and accounts to a batch. The registry does **not** store the certificate, but calldata is public anyway.
  - *Alternatives rejected for the MVP:* ZK (client-side RSA+X.509 proving is likely minutes and gigabytes, and a hosted prover is a backend); a backend verifier (forbidden).
- **Unattestable keys (Q1).** Users who decline the browser prompt, get anonymized (Firefox, possibly Safari), or use non-Yubico keys are **not sponsored**. The app explains and offers self-funded saving later (out of scope). The founder decides whether to add a tiny "unattested" budget instead.

**D5. Rate limits and budget** (ERC-7562 compliant for a **staked** paymaster).
- **Storage** (all in paymaster storage, readable and writable when staked, STO-031):
  - `opsBySender[period][sender]` (also sender-associated);
  - `appendsByLocator[period][locator]`;
  - `lifetimeOpsBySender[sender]`;
  - `spentWei[period]`.
- **Validation reads, never writes.** It rejects when:
  - `opsBySender ≥ maxOpsPerSenderPerPeriod` (default 5);
  - `lifetimeOpsBySender ≥ maxOpsPerSenderLifetime` (default 50);
  - for any locator in the calls, `appendsByLocator ≥ maxAppendsPerLocatorPerPeriod` (default 2);
  - `spentWei + maxCost > budgetPerPeriod − headroom`, where `headroom = maxCostPerOp × BUNDLE_HEADROOM` (default 8).
  - These values are proposals (Q4).
- **`postOp` writes.** It increments the counters and adds `actualGasCost + POSTOP_OVERHEAD` to `spentWei[period]`, using the `period` from context, not `TIMESTAMP`.
  - It uses only unchecked arithmetic on bounded values and makes no external calls, **so it cannot revert**. Its gas is fixed and covered by `verificationGasLimit`.
  - In `postOpReverted` mode it does the same accounting.
- **Reputation impact.** Headroom keeps the global cap from mass-invalidating pending operations. Per-locator and per-sender limits only invalidate the attacker's own operations.
- **Overshoot** is bounded by about one bundle (R1) and covered by the headroom.

**D6. Staking and funding.**
- The paymaster calls `entryPoint.addStake(unstakeDelaySec)`. The default stake is 1 ETH with 86400 s, pending Pimlico confirmation (task 5.3).
- The deposit is topped up by the owner. A low-deposit alert is a monitoring task the owner runs; there is no server.
- On testnet, use the faucet. The mainnet stake is a founder decision (Q3).

**D7. Threat model.**

| Attacker | Can still | Bounded by |
|---|---|---|
| Script with **software** P-256 keys | Self-funded writes only (registry is permissionless), including junk locator appends at about 1¢ each | Not sponsored (attestation gate); the victim's existing entry never moves; paginated scans |
| Owns **one real YubiKey** | Mint unlimited attested credentials, so unlimited fresh sponsored accounts; drain the period budget, so "saving paused" for everyone until the next period | Each sponsored operation needs a physical touch **and PIN** (UP+UV gate); per-sender, lifetime and global caps; owner pause and AAGUID/leaf denylist |
| **Stolen** victim YubiKey without PIN | Nothing sponsored (UV gate). Unsponsored: credProtect level 3 makes the key refuse to sign without PIN | The sibling change also closes the U2F/CTAP1 path |
| Stolen YubiKey **with PIN** | Overwrite or add-owner on the victim's vault (it can't decrypt without that key's PRF, though it has it). Same as today: a stolen key with PIN is a key compromise | Out of scope; the user re-keys |
| **Malicious bundler** | Censor, delay, or front-run within a bundle. It can't change signed callData or `paymasterAndData` (the account signs `userOpHash`, which covers them) | Switch bundler (any ERC-7562 bundler works); nothing in the policy trusts the bundler |
| **Mempool watcher** (if ops leak) | Pre-register junk under a pending op's locators (v2: no cap, so the victim still succeeds). Can't squat the vaultId (it is sender-derived) | Private bundler endpoint, which remains |
| **Paymaster owner key compromised** | Withdraw the deposit, raise caps up to the hard maxima, pause, denylist roots | Never vault data; hard maxima in code; owner key is hardware-backed (Q3) |
| **Attestation library bug** | Software keys get sponsored, so we're back to the caps-only world of today | Fuzzing, real-fixture tests, security review; owner pause |

**D8. Bundler compatibility.**
- The ERC-7562 profile is a staked paymaster with own-storage counters (STO-031), sender storage (STO-010) and read-only registry storage (STO-033). There are no banned opcodes; the period comes from `paymasterAndData`.
- **Precompiles in validation:** `0x05` modexp and `0x100` P-256 (the account's own validation already calls `0x100` on OP).
  - **ERC-7562's precompile allowance for RIP-7212 at `0x100` is UNVERIFIED for Alto.** It already works for CBSW account validation on Pimlico OP Sepolia today.
  - Task 5.2 proves both against a local Alto in safe mode, and task 7.2 against hosted Pimlico OP Sepolia.
- **Fallback if `attestMode = 1` validation is refused** (too much gas or a disallowed precompile): a two-step bootstrap. Step one is a sponsored `attest`-only operation whose validation does the same `verify`. If even that is refused, the client sends `attest` through a self-funded relayer-less path. *Not designed further unless needed (Q6).*

**D9. AA-H1 part 2 is a sibling change, `cbsw-uv-enforcing-implementation`, and also a mainnet gate.**
- It is a subclass of CBSW v1.1 that overrides `_isValidSignature` to require UV and `rpIdHash == sha256("cryoshield.app")` for WebAuthn owners, and to reject non-WebAuthn owners in the ERC-1271 path. Each account upgrades with one UV-verified `upgradeToAndCall` (replayable across chains, so the implementation is deployed at the same address everywhere). Account addresses and vault ownership don't change.
- **Why a sibling change:**
  - It changes the *account*, not the sponsorship policy.
  - It needs its own storage-layout proof and review.
  - This change's UV gate already covers sponsored operations.
- The paymaster here allows that one upgrade selector **only** with `target == sender`, the pinned implementation and empty init data. This is added when the sibling change ships (a new paymaster version; D1).
- *Alternative noted for the founder:* migrating to Kernel v3 / Safe on EntryPoint v0.7 gives audited UV enforcement but **no rpIdHash check**, and changes every account address.

**D10. Gas budget per operation** (estimates; tasks measure and update `contracts/GAS.md`).

| Operation | Account + EntryPoint | Paymaster validation | Attestation | Registry | postOp | Total (est.) |
|---|---|---|---|---|---|---|
| First op (deploy, attest 2 keys, create 1 KB) | about 450–550k (deploy + WebAuthn) | about 40k + 2×verify (about 200–600k) | attest 2× (about 250–650k) | about 0.9M | about 70k (cold counters) | **about 1.9–2.8M** |
| Update 1 KB | about 120k | about 40k | — | about 0.21M | about 15–30k | **about 0.4M** |
| Add key | about 130k | about 45k + 1×verify | 1× | about 0.3M | about 30k | **about 0.8–1.1M** |

- On OP Mainnet (L2 gas about 0.001 gwei, L1 data fee about 6.8e10 wei per 2.5 KB; `target-op-sepolia` design), the first op costs **about $0.01** and later ops about $0.003. That is well under the PRD's ≤ $1 per vault.
- The v0.6 `verificationGasLimit` must cover account validation + paymaster validation (including the attestation `verify`), and separately `postOp`. The client sets it from `eth_estimateUserOperationGas` with a margin.

**D11. Migration: v1 to v2 (testnet only).**
- Deploy v2, the paymaster and the AttestationRegistry to OP Sepolia. Deployment records gain per-contract entries (deployment-targets delta).
- The web app writes **only** to v2 and reads v1 and v2 (v1 is read-only in the UI). The recovery tool reads both, v2 first.
- The founder's test vault is re-created on v2. There are no other users.
- Mainnet launches directly on v2 with this paymaster. **v1 is never deployed to OP Mainnet.**

**D12. EntryPoint v0.7 path.**
- The policy logic (callData decoding, gates, counters) lives in an internal library, `SponsorshipPolicy`, that takes plain arguments.
- A future `CryoShieldPaymasterV07` adapts `PackedUserOperation` and the v0.7 `postOp(mode, context, actualGasCost, actualUserOpFeePerGas)`. A v0.7 `postOp` revert rolls back only the inner call, but the never-revert rule stays.
- It is only useful if the account moves off CBSW v1.1.

## Data flows

**Enroll → attest → sponsor → write (create):**
1. **Enroll.** For each of two keys, the app calls `create()` with `attestation: "direct"`, credProtect 3, the PRF extension and `rp.id = cryoshield.app`. It keeps the `attestationObject` and `clientDataJSON`. If `fmt != "packed"` or the chain doesn't parse, it explains and does not sponsor (D4, Q1).
2. **Build the operation.** Owners = the two P-256 keys, and the account address is counterfactual. `salt` is random, and `vaultId = keccak256(abi.encode(account, salt))` is put in the AAD and the blob is encrypted. callData = `executeBatch[attest(account, [att1, att2]), createVault(salt, blob, locators)]`, and `paymasterAndData = paymaster ‖ 0x01 ‖ period ‖ 0x01`.
3. **Sign.** One tap with PIN gives UP=1 and UV=1. The signature covers `userOpHash`, which covers callData and `paymasterAndData`.
4. **Submit.** The operation goes to Pimlico's bundler endpoint, which only bundles. The bundler simulates: account validation, then paymaster validation (allowlist → signature gate → `verify` attestations → limits).
5. **Execute.** The EntryPoint deploys the account, `attest` writes `attestedKey` × 2 and `attestedAccount`, and `createVault` stores the blob. `postOp` updates the counters and `spentWei`.
6. **Later writes** are `executeBatch[updateVault]` / `[addOwnerPublicKey, addLocators, updateVault]` with `attestMode = 0`. A new key needs an `attest` call in the same batch with `attestMode = 1`.

**Read and recover:** unchanged. Readers page `resolveLocator` on v2 and then v1, call `getVaults`, and keep the candidate that authenticates.

## Phasing

| Phase | Content | Gate |
|---|---|---|
| 0 | This plan (PR, docs only) | Merged |
| 1 | VaultRegistry v2 + vaultId vector + recovery-tool dual read | Tests green, security review |
| 2 | CryoShieldPaymaster core (allowlist, signature gate, limits, staking) with a test attestation registry | Local Alto safe-mode simulation passes |
| 3 | AttestationRegistry (CBOR/DER/RSA, real Yubico fixtures) | Gas measured, fuzzing green |
| 4 | Web app integration (attestation capture, paymasterAndData, v1+v2 reads) | E2E green |
| 5 | OP Sepolia deploy, stake, hosted-Pimlico compatibility, measured costs | Real sponsored create with two real YubiKeys |
| 6 | Security review, then the **mainnet gate**: this change and the sibling `cbsw-uv-enforcing-implementation`, founder approval | Founder |

## Risks / Trade-offs

- **[Hosted Pimlico refuses the paymaster]** because of the stake amount, safe-mode precompile rules, or gas. → Task 5.3/7.2 confirms early on OP Sepolia. Fallbacks: another hosted bundler, or the two-step bootstrap (D8).
- **[Attestation unavailable in some browsers]** → Q1. Measure on real browsers in phase 4 before the mainnet gate.
- **[Custom DER/CBOR/RSA code, unaudited]** → Narrow subsets only (exact Yubico/packed shapes), reused audited building blocks where they exist, fuzzing, real fixtures, and owner pause.
- **[One YubiKey still drains the period budget]** → Accepted. The caps bound the damage, a touch plus PIN per operation makes it slow, and the owner can pause or denylist.
- **[Linkability from calldata]** → Q2.
- **[Paymaster owner key]** is a new privileged key, limited to gas money → hardware-backed (Q3).
- **[v1 remains with its 16-cap]** → testnet only; mainnet never sees v1.

## Open questions for the founder

- **Q1:** Users whose attestation is withheld (declined prompt, Firefox anonymize, Safari, Nitrokey). Options: (a) not sponsored; (b) a tiny separate "unattested" budget with strict per-sender limits; (c) refuse to create.
  - **Recommendation:** (a) for the mainnet launch, plus measuring how often it happens on testnet.
- **Q2:** Accept that each user's key model and batch (≥100k devices) and the link between their two keys is public forever in calldata?
  - **Recommendation:** accept and disclose it in the privacy page; revisit with ZK later.
- **Q3:** The paymaster owner. Options: (a) the founder's hardware wallet; (b) a 2-of-3 Safe.
  - Also the mainnet stake (about 1 ETH, refundable after a 1-day unstake) and the initial deposit.
- **Q4:** Default limits: 5 ops per account per day, 50 per account lifetime, 2 appends per locator per day, a daily budget (testnet 0.05 ETH; mainnet about $20), and a per-op max cost.
- **Q5:** Pin Google Titan / Feitian roots as well (their PRF support is unverified), or Yubico only?
- **Q6:** If hosted Pimlico rejects in-validation attestation, accept a two-step enrollment (one extra tap)?
- **Q7:** The sibling account fix. Options: (a) the CBSW subclass upgrade (recommended; keeps addresses, unaudited small diff); (b) a migration to Kernel/Safe on v0.7 (audited, but no rpId check and new addresses).

## Security review

To be recorded at task 8.1, in `docs/reviews/paymaster-v2-attested-sponsorship.md`.

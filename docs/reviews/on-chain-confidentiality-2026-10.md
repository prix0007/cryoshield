# Security audit: confidentiality of the published vault data

**Date:** 2026-10-05
**Question:** Everything CryoShield stores is public forever (OP Sepolia today, OP Mainnet later, plus the Arweave mirror). Can any of it be decrypted without an enrolled hardware key?
**Method:** read-only review of `packages/vault-crypto`, `apps/web` (write, unlock and mirror paths), `contracts/src/VaultRegistry.sol` and `tools/recover`; the vault-crypto test suite (146 tests, all passing, Node 22); and a throwaway proof-of-concept script against the built library. Nothing was changed, no transactions were sent.
**Builds on:** `security-audit-2026-10.md`, `vault-crypto-v1.md`, `bind-vault-id.md`, `enforce-credprotect-uv.md`. Findings already recorded there are referenced, not repeated.

This is an internal review. CryoShield remains unaudited by any third party.

## Verdict

**No published byte decrypts, or helps decrypt, a vault without the PRF output of one enrolled credential.** That PRF output exists only inside a FIDO2 authenticator and is released only by a user-verified ceremony (PIN or biometric) on that key. The derivation `PRF → HKDF-SHA256 → AES-256-GCM` is symmetric only, so there is no public-key layer to break, now or with a quantum computer.

The precise statement, with its conditions:

1. **What a reader of the chain and Arweave gets** is the ciphertext and public metadata listed in §1. None of it is secret, and none of it is derived from key material in an invertible way (§2).
2. **What unlocks a vault** is exactly one of: a 32-byte PRF output of any one enrolled credential (any-of-N), or the 32-byte data key. Both live only in RAM during a ceremony, on the user's device.
3. **The ways a vault can still be read without a key tap at that moment** are not weaknesses of the published format. They are the places where the PRF output or the data key is briefly in the clear: the user's browser or desktop while unlocking. See §3. One consequence deserves a change in guidance (F1): a single capture is permanent, because the keys never rotate and the ciphertext never disappears.

## 1. Inventory: what is public

| Where | Field | Secret? | Notes |
|---|---|---|---|
| Registry blob | magic, version, suite, mode, M, N | no | format metadata |
| Registry blob | `rpId` (`cryoshield.app`) | no | identifies the service |
| Registry blob | `wrapSalt` (32 B, random per vault) | no | HKDF salt, useless without the PRF |
| Registry blob, per key | credential ID (up to 128 B) | no | the same handle any WebAuthn site receives; on YubiKey it is encrypted under the device key |
| Registry blob, per key | `wrapNonce` (12 B), `wrapped` (48 B) | **ciphertext** | AES-256-GCM of the data key under `HKDF(prf, wrapSalt)` |
| Registry blob | `payloadNonce` (12 B), `payloadCt` (64k+16 B) | **ciphertext** | AES-256-GCM of the padded JSON payload under the data key |
| Registry | `vaultId`, `owner` (smart-account address), `version` | no | the `vaultId` is also bound into every AAD |
| Registry index | `locator` → `vaultId[]` (one locator per key) | no | `HKDF(prf, salt = ∅, info = locator)`: a one-way image of the PRF |
| Registry events | `blobHash` per version, `LocatorAdded` | no | keccak of ciphertext |
| Smart wallet | each key's P-256 public key | no | the signing key, unrelated to the PRF secret |
| Calldata / bundler / Pimlico logs | the same blob, the WebAuthn signature | no | ciphertext only; the ERC-4337 path never carries the PRF |
| Arweave item | the blob, tags `CryoShield-Vault-Id`, `-Version`, `-Locator`, and the uploader's ephemeral secp256k1 address | no | the upload key is random per browser session and never derived from vault material |
| Chain history | every past blob version, with block timestamps | **ciphertext** | permanent, see F1 |

Proof-of-concept check A: a freshly created 2-key blob was searched for the PRF outputs, wrap key, data key and locator of its keys. None appears in it. The locator and the wrap key derived from the same PRF share no bytes (different HKDF salt and info).

## 2. Why the public data does not help

- **Locator vs wrap key.** Both come from the same PRF output, but through HKDF-SHA256 with different salts (`∅` vs `wrapSalt`) and different `info` strings. Going from the public locator to the wrap key would require either inverting HMAC-SHA256 to recover the 256-bit PRF, or a related-key weakness in SHA-256 that is not known. Confirmed by the TypeScript and Python implementations agreeing on all derivation vectors.
- **Wrapped data key.** AES-256-GCM under a 256-bit key with a per-vault salt. Each `wrapKey_i` is used for exactly one encryption ever: entries are copied byte for byte by `addKey` and `updatePayload`, and a retry after `VaultIdTaken` draws a fresh `wrapSalt` and data key (`createVault` is called again). So even the blob of a reverted creation, which does land in public calldata, shares no key with the one that was finally registered.
- **Payload.** Encrypted under the random 256-bit data key with a random 96-bit nonce and an AAD covering the whole header, every entry and the `vaultId`. Tampering, re-ordering, cloning under another `vaultId`, or editing M/N makes authentication fail (`NO_MATCHING_KEY` or `AUTH_FAILED`). The known plaintext prefix `{"v":1,"items":[{"l":"` is harmless for a correctly used AEAD.
- **No low-entropy input anywhere.** No password, no PIN and no user-chosen value enters the key schedule, so offline guessing, partitioning-oracle attacks on GCM's lack of key commitment, and rainbow tables do not apply. The PIN protects the key device, not the ciphertext.
- **Quantum.** Grover halves AES-256 and SHA-256 to 128-bit work. The P-256 public keys on the smart wallet are breakable by a large quantum computer, but they only authorise *writes*. See F5 for the one hardware assumption this rests on.
- **Clones and squatting** (spec §4.1, §8): a byte-identical copy under an attacker's `vaultId` never authenticates. Proof-of-concept check B: the right PRF under a cloned `vaultId` gives `NO_MATCHING_VAULT`, as does a random PRF under the right one.
- **The registry parses nothing and has no admin**: it cannot leak or alter what it stores, and the owner-only `updateVault` means a third party cannot even replace the ciphertext.

## 3. Where the secret is in the clear, and what that means

The PRF output, the wrap key, the data key and the plaintext exist in RAM on the user's device during a ceremony, in the web app (`apps/web`) or the recovery tool. Code that runs there with the user can read them. This is inherent to a client-side design and is the only route to the plaintext. Three facts about this route matter for the "in any case" question:

| Route | Needs a key tap at that moment? | Covered by |
|---|---|---|
| One enrolled key plus its PIN or biometric | yes | design (any-of-N) |
| One enrolled key without PIN | cannot decrypt: without UV the authenticator uses `CredRandomWithoutUV`, so the PRF output is a different value; credProtect 3 additionally refuses any assertion. It can only sign writes (audit AA-H1) | `enforce-credprotect-uv` |
| Malicious JavaScript on the RP origin (compromised build, deploy pipeline, DNS, extension), or malware on the device | yes, once; afterwards never again (F1) | audit CI-C1, WEB-M1; F1 below |
| Server operators: Fly, Pimlico, RPCs, Arweave, Turbo | no access: they see §1 only | verified in code: nothing but ciphertext, locators, signatures and the ephemeral upload key leaves the device |

## Findings

| ID | Severity | Finding | Proof | Recommendation |
|---|---|---|---|---|
| F1 | MEDIUM (design, accepted) | **No forward secrecy and no key rotation.** The data key is kept by `updatePayload` and `addKey`, and each wrap key is a deterministic function of a per-credential PRF output that never changes. A one-time capture of the PRF output or the data key (a malicious page at the next tap, malware, a memory dump) therefore decrypts **every future version** of the vault as well as every past one, and the ciphertext history is public forever, so nothing can be "unpublished". Editing the vault after a suspected compromise gives no protection. | PoC check C: the data key unwrapped from version 1 decrypted version 2 directly, with no PRF; the wrapped entries of v1 and v2 are byte-identical. | This cannot be fixed inside 1-of-N without every key present (re-wrapping needs each key's PRF), and the single-tap flow is a deliberate trade. Do: (a) state it in `docs/system-design.md` §2 and the spec §9; (b) add compromise guidance to the app and `docs/supported-devices.md`: *if you think your device or browser was compromised, move the secret itself (new seed phrase, regenerated codes) and create a new vault with freshly enrolled keys; editing the existing vault does not help.* A new vault in the app enrols new credentials, so it gets new PRF outputs and a new data key; re-using the same credentials would not. |
| F2 | LOW | **Payload nonce uniqueness is checked only against the current version.** `drawFreshPayloadNonce` refuses a nonce equal to the blob's current one, but earlier versions are public and share the same data key. A repeat of any historical nonce would give two public GCM ciphertexts under one key and nonce (plaintext XOR, and recovery of the GHASH key for forgeries). With a healthy CSPRNG the chance is about k²/2⁹⁷ for k versions, negligible; the check matters only if the RNG is broken, and then it is insufficient. | PoC check D: an RNG that returned version 1's nonce was accepted for version 4. | Either document the check as a sanity check only, or make the guarantee real: derive the payload nonce as `HKDF(dataKey, info = "payload-nonce" ‖ u32be(version))` with the registry version, which also removes the RNG from the update path. That is a format change (new version byte once a mainnet vault exists), so decide before mainnet. |
| F3 | LOW | **The padded length reveals the secret's size class.** Padding to 64 bytes hides the exact length, but the blob of a 12-word seed phrase is 526 bytes and a 24-word phrase 590 bytes with two 64-byte credential IDs. An observer can often tell a 12-word from a 24-word phrase, or one item from several. | PoC check E. | Accept and document, or pad to a fixed size class (for example always to the largest payload that fits the key count, at the cost of gas). Note that the spec claims only that the *exact* length is hidden, which holds. |
| F4 | LOW | **Software AES in the browser.** `@noble/ciphers` implements AES with T-tables; its README says algorithmic constant time is targeted but cache timing cannot be guaranteed in JavaScript. The web app does all AES-GCM in `@noble/ciphers`, although WebCrypto's native, hardware-backed AES-GCM is available in every browser the app supports. A cross-origin cache-timing attack on a tab is remote, but the key material it would target is the one thing the whole design protects. | code-evident (`packages/vault-crypto/src/aead.ts`; `node_modules/@noble/ciphers/README.md` → "Constant-timeness") | Use `crypto.subtle` AES-GCM in `aead.ts` when `globalThis.crypto.subtle` exists (noble ships a `webcrypto.js` wrapper), keeping noble for Node, tests and vectors. Same bytes, same vectors; the test suite already runs in Chromium. |
| F5 | INFO | **The quantum-safety claim rests on one authenticator property**: that the hmac-secret `CredRandomWithUV` cannot be derived from the credential's P-256 private key. On YubiKey 5 both are derived from the device master secret via a KDF and are believed independent, but this is outside CryoShield's control and undocumented here. Side-channel results such as EUCLEAK (YubiKey 5 firmware < 5.7) extract the ECDSA key only, which permits writes, not decryption. | reasoning | Add the assumption and the device dependency to `docs/supported-devices.md` and the spec's informative notes. |
| F6 | INFO | **Public metadata inventory** (§1) is not written down anywhere for users: key count, credential IDs (linkable to the smart-wallet owners), number and timing of edits, size class, and the locator, which links every vault the same credential ever opened. | n/a | Document in the privacy page or `docs/compliance`. |
| F7 | INFO | **The served JavaScript is the trust root.** A reproducible build, `release.json` and SHA-pinned CI exist, but a user's browser has no way to verify that the page it loaded matches the audited commit. This is the realistic path to F1. | audit CI-C1 context | Already tracked (owner-only releases). Consider publishing the release tree hash on the architecture page and in the GitHub Release so a user can compare `release.json` by hand. |

## Verified sound

- **Suite and derivation**: HKDF-SHA256 with domain-separated info strings and distinct salts; AES-256-GCM with 96-bit random nonces and 128-bit tags; one encryption per wrap key; AAD binds header, entries and `vaultId` (`format.ts`, `vault.ts`, Python `format.py` and `vault.py` agree byte for byte).
- **Randomness**: every production draw comes from `crypto.getRandomValues` (`webCryptoRng`, `lib/bytes.ts`, viem's `generatePrivateKey`). The replay RNG is exported only from the `/testing` subpath, nothing in `apps/web/src` imports it, and `verify-build.mjs` fails on E2E-only code in a bundle.
- **No key material leaves the device**: the web app sends locators to the RPC, ciphertext and signatures to the bundler, and ciphertext plus tags to Turbo; the paymaster context carries only the policy id. Error references strip URLs and long hex. The landing-page analytics beacon is excluded from `/app/` by CSP and never loads there.
- **PRF handling**: UV required on `create()` (inside `authenticatorSelection`) and `get()`, the UV flag checked on every response, credProtect 3 confirmed from authenticator data at enrolment, PRF buffers wiped on every path, and distinct PRF outputs enforced at creation.
- **Write path integrity**: owner-only updates, read-back of the exact blob after every write, and retry after `VaultIdTaken` with fresh key material.
- **Recovery tool**: identical AAD construction and the `SHA-256("WebAuthn PRF" ‖ 0x00 ‖ salt)` CTAP mapping, UV enforced, core dumps disabled.

## Proof-of-concept transcript

```
A. public blob bytes: 526 | rpId cryoshield.app | N 2 | credIds public: true | payloadCt 208
A. secret values appearing verbatim in the public blob: none | locator in blob: false
B. random PRF -> NO_MATCHING_VAULT
B. right PRF, cloned vaultId -> NO_MATCHING_VAULT
C. v2 decrypted with the data key captured from v1 (no PRF, no key): {"v":1,"items":[{"l":"Bitcoin seed","s":"new secret after ro
C. same wrapped entries in v1 and v2 (byte-identical): true
D. update accepted with a nonce equal to v1's payload nonce (same data key): true
E. blob length 12-word seed: 526 | 24-word seed: 590 | payload bytes 140 236
F. legit open ok: true
```

The script used only the built `@cryoshield/vault-crypto` and `@noble/ciphers` (to unwrap the data key with a known PRF, standing in for an attacker who captured it). It is not part of the repository.

## Deployed contract: OP Sepolia `0xB43f58cF17e64B603aE5588a1DD17E96a0849e44`

Checked on 2026-10-05 without network access to the chain (the review environment's egress policy denies every OP Sepolia RPC and explorer host), so the live state could not be read. What could be established from the repository alone:

| Check | Result |
|---|---|
| Deployment record vs source | `contracts/broadcast/Deploy.s.sol/11155420/run-latest.json` (tx `0xb36085…0759`, block 49568053, status 1, CREATE2 via `0x4e59…956C`, salt `keccak256("cryoshield.vault-registry.v1")`) carries 3,845 bytes of init code. A fresh build of the current `VaultRegistry.sol` with the pinned solc 0.8.28 (`7893614a`), optimizer 10,000 runs, EVM `cancun`, produces **byte-identical** init code. Runtime code: 3,817 bytes, keccak `0x6895351e…43d2`. |
| Source drift since deploy | None: `git log 3c4a8cc..HEAD -- contracts/src/VaultRegistry.sol contracts/foundry.toml` is empty. The deployed bytecode is this source. The October audit additionally recorded a Blockscout full match and a Sourcify exact match for the live address. |
| Test suite | `forge test`: 52 passed (unit, fuzz 1,000 runs, invariants 256×200, bytecode and source immutability checks). `forge snapshot --mc GasTest --check`: unchanged. |
| Privilege | No owner, admin, proxy, pause, selfdestruct, delegatecall or external call. `test_deployerHasNoSpecialPower` and `invariant_deployerOwnsNothing` hold. Nothing on chain can read, alter or delete a blob except its owner account's `updateVault`, which only replaces (history stays in calldata and events). |
| Confidentiality role | The registry stores and returns opaque bytes and never parses them, so it has no bearing on the decryption question beyond publishing the data in §1. |

Static review of the contract found **no new issue**. The known ones stand, all availability or cost, none confidentiality:
- **Locator stuffing** (AA-M1): anyone can append up to 16 vaultIds under any locator, with sponsored gas; a victim's key then needs a fresh credential. Registry v2 before mainnet.
- **vaultId squatting** (AA-M2): the preflight `eth_call` shows the chosen vaultId to the RPC provider before the signed userOp is sent. Griefing only, since the blob is bound to its vaultId.
- **Arbitrary 1 KB blobs under any locator**: the registry validates size only, so a squatter can store any bytes, and with the paymaster policy as it is (AA-M3) CryoShield may pay for them. Clients skip blobs that fail to decode or authenticate.
- **Overwrite by a key holder** (AA-H1 path): an account owner can replace the blob with anything; the chain history and the recovery tool's event walk keep every earlier version readable.

**Still to do once an RPC is reachable** (one script, read-only): walk `VaultCreated`, `VaultUpdated` and `LocatorAdded` from block 49568053; count vaults, versions and blob sizes; decode every blob with `decodeVault` and flag any that fail, carry an unexpected `rpId`, or whose entry count differs from the vault's `LocatorAdded` count; list locators with more than one vaultId (squatting) or at the cap of 16 (stuffing); confirm every owner is a Coinbase Smart Wallet v1.1 whose owner index order matches the blob's entry order; and compare `eth_getCode` with the keccak above.

## Suggested follow-up changes

1. `docs`: F1 guidance (system design, spec §9, supported devices, app copy), F5 and F6 notes.
2. OpenSpec change for F4 (WebCrypto AES-GCM in browsers), with a security review; no format change.
3. Decide F2 and F3 before the first mainnet vault, since both would need a new version byte afterwards.

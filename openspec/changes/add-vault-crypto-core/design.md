# Design

## Context

This is a greenfield repo; no code exists yet. Motivation is in proposal.md, and requirements are in `specs/vault-crypto/spec.md`.

Constraints:
- symmetric crypto only;
- the blob is ≤ 1024 bytes and stored as opaque bytes on Arbitrum and Arweave;
- the format must still be decodable decades from now by an independent desktop tool;
- there is no external audit for the MVP.

## Goals / Non-Goals

**Goals:**
- One small, dependency-light, pure library (no I/O, no WebAuthn calls) that both browser and Node can run.
- A byte-exact format simple enough to reimplement in Python or Rust from the spec alone.
- Test-vector-first development: the vectors are the normative artifact alongside the spec.

**Non-Goals:**
- Performing WebAuthn ceremonies. The library takes PRF outputs as inputs.
- Key removal, rotation, or re-wrap flows (a later change). Adding a key (mode 0x01) and updating the payload are in scope.
- Constant-time guarantees beyond what WebCrypto and @noble provide.

## Decisions

### Binary layout (v1)

All integers are big-endian.

| Field | Size | Notes |
|---|---|---|
| magic | 4 | `CRYO` |
| version | 1 | 0x01 |
| suite | 1 | 0x01 = HKDF-SHA256 + AES-256-GCM |
| mode | 1 | 0x01 any-of-N, 0x02 Shamir |
| threshold M | 1 | 1 in mode 0x01; 2..N in mode 0x02 |
| count N | 1 | 2..8 |
| rpIdLen + rpId | 1 + 1..64 | ASCII |
| wrapSalt | 32 | random per vault |
| N × entry | — | see below |
| payload nonce | 12 | |
| payload ct + tag | 64k + 16 | padded plaintext (2-byte length prefix + data, zero-padded to a multiple of 64) |

Each entry is:
- `credIdLen` (1 byte) + `credId` (1..128 bytes)
- `wrapNonce` (12 bytes)
- wrapped secret + tag:
  - mode 0x01: 32-byte data key + 16 = 48 bytes
  - mode 0x02: share = 1-byte x + 32 bytes, + 16 = 49 bytes

Size budget, for an RP ID such as `cryoshield.app` (14 bytes), 2 keys, and 64-byte credential IDs:
- header ≈ 55 bytes
- entries ≈ 2 × 125 = 250 bytes
- payload overhead = 28 bytes

That leaves about 690 bytes, so about 640 bytes of usable secret after padding. This is enough for a 24-word seed plus 10 TOTP backup codes.

### Other decisions

- **AAD binding:**
  - Wrap AAD = the immutable header fields + that entry's index and credential ID:

    `magic || version || suite || mode || u8(rpIdLen) || rpId || wrapSalt || u8(index) || u8(credIdLen) || credId`

    This prevents swapping entries between vaults or positions. It deliberately excludes N and M, so `addKey` can append an entry with one existing key; the original design bound the whole fixed header, which would have required every key to be present. (Overwatcher decision, from frontend review.)
  - Payload AAD = all bytes preceding the payload nonce, so any edit invalidates decryption.
  - *Alternative rejected:* AAD over the whole blob via a hash. Simpler to reason about, but it leaves no way to identify which entry failed.
- **One PRF input, two HKDF derivations (single tap):** every ceremony evaluates only the global locator salt. From that output:
  - locator = HKDF(empty salt, info `cryoshield/v1/locator`);
  - wrapKey = HKDF(salt = the blob's per-vault wrap salt, info `cryoshield/v1/wrap`).

  The client holds the PRF output in memory while it fetches the blob by locator, then derives wrapKey with no second tap. The per-vault salt still makes wrapping keys unrelated across vaults that share a credential.
  - *Alternative rejected:* a second PRF input equal to the wrap salt. It needs two taps when the blob isn't cached, and gives no security gain because the wrap salt is public.
- **Shamir implementation:** the `shamir-secret-sharing` npm package (Privy), version pinned, with its share encoding fixed by our vectors. Audited by Cure53 and Zellic at earlier commits; the pinned version is 0.0.4. See "Shamir dependency: audit verification" below.
  - *Alternative rejected:* an in-house GF(2^8) implementation. Unaudited code in a security-critical path.
- **Squatting-tolerant lookup:** the contract's index maps a locator to an append-only, capped list of vaultIds. Locators are public once used, so anyone can append blobs under them. The library exposes `selectVault(candidates, prf)`, which tries each blob and returns the first whose wrapped-key unwrap authenticates. AES-GCM authentication makes forged candidates indistinguishable from noise, not dangerous.
- **Zeroization:** the library overwrites (`fill(0)`) every PRF output and derived-key `Uint8Array` it receives or creates, in `finally` blocks. JavaScript can't guarantee no copies remain (the garbage collector, WebCrypto internals), so this is best effort. The requirement still forbids persisting or logging these values.
- **Randomness injection:** every random draw (wrap salt, data key, nonces, Shamir coefficients) goes through an injectable RNG interface. Production uses WebCrypto, and tests use vector-supplied bytes.
- **Credential-ID cap of 128 bytes:** covers YubiKey resident and non-resident credentials. Encoders refuse anything longer.

### Shamir dependency: audit verification (task 6.1)

Pinned version: `shamir-secret-sharing` **0.0.4** exactly (no caret); the pnpm lockfile integrity hash covers the tarball. Full notes are in `docs/reviews/shamir-dependency.md`.

Audit trail (from the package README and upstream git history, `github.com/privy-io/shamir-secret-sharing`):
- **Cure53**, February 2023. Report: https://cure53.de/audit-report_privy-sss-library.pdf. Audited commit `3383ad9` (0.0.1-beta.6). It had three findings:
  - PVY-01-002 (High): the top coefficient might be zero. Fixed in `d02a027` (forces a nonzero coefficient), and Cure53 verified the fix.
  - PVY-01-001 (Info) and PVY-01-003 (Info). Both fixed and verified.
- **Zellic**, June 27–29 2023, final report August 15 2023. Report: https://github.com/Zellic/publications/blob/master/Privy_Shamir_Secret_Sharing_-_Zellic_Audit_Report.pdf. Audited commit `cd8422d` (0.0.2). It had one finding: 3.1, missing uint8 bounds in arithmetic (Low). Fixed upstream in `1c51059`, released in 0.0.3.
- **0.0.4** (January 10 2025) is newer than both audits. It contains two changes:
  - `3333451` reverts the PVY-01-002 fix: coefficients are uniform random again, zero included;
  - `955bf20` documents the biased x-coordinate shuffle (comment only).

  **Neither firm audited 0.0.4, or the revert. We reviewed it internally.**

Decision (overwatcher, option a): pin 0.0.4. Rationale:
- With uniformly random coefficients, zero included, any t−1 shares are independent of the secret: perfect secrecy.
- Forcing a nonzero top coefficient removes candidate polynomials, so t−1 shares can rule out one secret value per byte. That is an information leak, and the revert restores the textbook construction.
- The biased x-coordinate shuffle is harmless, because x-coordinates are public in every share encoding (including ours).

The security reviewer confirms this by diffing 0.0.3 against 0.0.4 (task 8.3).

Scope: Shamir M-of-N (mode 0x02) is a PRD "Could" capability and is not in the MVP's default path. It stays in the library and the vectors, and the README marks it experimental.

### Implementation assumptions (recorded during apply)

- **Shamir randomness injection:** the library draws randomness only through its own `shamir-secret-sharing/csprng` module (WebCrypto in browsers, `node:crypto` in Node) and exposes no RNG parameter. Production always uses that CSPRNG. For deterministic vectors, the test suite substitutes that module with a replaying RNG. We don't modify or vendor the audited code.
- **Shamir share encoding inside a wrapped entry:** `x (1 byte) || y (32 bytes)`, as in the layout table. The library's native order is `y || x`, and the adapter converts.
- **Vector randomness:** the vectors give two separate replay streams:
  - `rng`: the library's own draws, in the fixed order wrapSalt, dataKey, wrapNonce[0..N-1], payloadNonce;
  - `shamirRng`: 255 coordinate-shuffle bytes, then (M−1) coefficient bytes per secret byte.

  Vector coefficients are nonzero, so the stream is also valid for 0.0.3.
- **Padding cap:** "capped by the blob size limit" means the padded plaintext (a multiple of 64) must fit in the space left under 1024 bytes. So `maxPayloadBytes = floor(available / 64) * 64 − 2`, and the ciphertext is always 64k + 16.
- **Empty secrets** are rejected (`INVALID_ARGUMENT`); a vault always holds at least 1 byte.
- **Padding canonicality:** after authentication, the decoder rejects a length prefix that exceeds the padded size, and any nonzero pad byte (`MALFORMED`).
- **Error codes:** `BAD_MAGIC`, `UNSUPPORTED_VERSION`, `UNSUPPORTED_SUITE`, `UNSUPPORTED_MODE`, `MALFORMED`, `VAULT_TOO_LARGE`, `TOO_FEW_KEYS`, `TOO_MANY_KEYS`, `INVALID_ARGUMENT`, `NO_MATCHING_KEY`, `INSUFFICIENT_SHARES`, `AUTH_FAILED`, `NO_MATCHING_VAULT`, `USER_NOT_VERIFIED`.
  - Tampering inside a wrap AAD (the immutable header fields, a credential ID, an entry's position, or a wrapped key) shows up as `NO_MATCHING_KEY`, which can't be told apart from a wrong key.
  - Tampering that only the payload AAD or the payload ciphertext covers shows up as `AUTH_FAILED`.
- **Candidate selection** accepts a candidate only if the whole open succeeds: an unwrap authenticates and the payload authenticates. So a junk blob that copies a genuine header and entries but carries a forged payload is skipped.
- **RP ID charset:** "ASCII" is read as visible ASCII 0x21..0x7E (no spaces or control bytes); RP IDs are domain names.
- **Duplicate credential IDs** within one blob are rejected (`MALFORMED` when decoding, `INVALID_ARGUMENT` when creating or adding), because `openVault(credId)` would be ambiguous otherwise.
- **PRF buffer ownership:** `createVault`, `openVault`, `selectVault`, `addKey`, and `updatePayload` consume the caller's PRF buffers: they zero them in `finally`. `deriveLocator` and `deriveWrapKey` leave their input intact, because the single-tap flow needs the same PRF output after deriving the locator, but they zeroize their intermediates. `deriveWrapKey` returns a key that the caller must zero.
- **RNG draw order for `addKey` / `updatePayload`:** `addKey` draws newWrapNonce(12), then payloadNonce(12). `updatePayload` draws payloadNonce(12).
- **Security-review fixes (see `docs/reviews/vault-crypto-v1.md`):**
  - The WebAuthn helper is split into `webauthnPrfCreateOptions()` (UV inside `authenticatorSelection`, plus `residentKey: "required"`) and `webauthnPrfGetOptions()` (top-level UV).
  - `assertUserVerified(authenticatorData)` checks the UV flag.
  - `replayRng` moved to the `@cryoshield/vault-crypto/testing` subpath.
  - `addKey` and `updatePayload` refuse a payload nonce equal to the current one.
- **AES-GCM implementation:** `@noble/ciphers` (`gcm`) for both wrapping and payload. It is synchronous, identical in Node and browsers, and lets derived keys stay in zeroizable `Uint8Array`s. WebCrypto is used only for the default RNG.

## Threat / Abuse Considerations

- **Public ciphertext forever:** only AES-256 and HMAC-SHA256 are used, both considered quantum-resistant at this key size. The suite ID allows future versions; old blobs cannot be re-encrypted once they are public, which is accepted.
- **Nonce reuse:** every nonce is random 96-bit and every data key is fresh per encryption, so collision risk is negligible at this scale. Updating the payload (`updatePayload`, `addKey`) keeps the data key and re-encrypts with a fresh random payload nonce, so a key is used for at most a handful of messages and the random-nonce collision bound is negligible.
- **Metadata leakage:** credential IDs, the RP ID, and the key count are public. Padding hides the exact secret length, but labels or secret types MUST stay inside the encrypted payload.
- **Malicious blob (attacker-written on-chain):** the decoder bounds-checks every length field before allocating, and the fuzz tests in the tasks cover this.
- **Locator squatting:** an attacker who sees a locator on-chain appends junk vaults under it. The client tries every candidate (the list is capped by the contract) and only an authenticating blob is accepted. The cost is a few extra RPC reads and decrypt attempts.
- **PRF output exposure:** it is the root secret for every vault using that credential. It is kept in memory only, zeroized after use, and never logged or stored.
- **Downgrade:** unknown versions, suites, and modes are rejected; there is no negotiation.
- **Implementation bugs, no audit:** mitigated by the vectors, independent reimplementation in the recovery tool (cross-check), property tests, and a mandatory security-review task.

## Risks / Trade-offs

- [One PRF output now feeds every vault using that credential] → Each vault's wrap salt keeps the wrapping keys independent. Compromise of the PRF output was already total compromise under the two-input design.
- [The `shamir-secret-sharing` package changes its share format] → Pin the version and lock the encoding with vectors. Mode 0x02 decoding must keep working forever, so vendor the package source if upstream breaks it.
- [YubiKey credential IDs larger than expected eat payload space] → The encoder reports the remaining capacity, and the UI shows it before saving.
- [The format is frozen once mainnet vaults exist] → The spec and vectors are reviewed before any mainnet deploy, and v1 decoding is kept forever.

## Migration Plan

This is a new format, so nothing needs migrating. Mainnet deploy of the contract is gated on this change being archived.

## Open Questions

- Should the vector file also carry Python or Rust reference outputs, generated independently, to cross-check the TypeScript library? This can be decided while writing the recovery tool without changing this spec.
  - *Resolved during apply:* the vectors are generated by an independent Python implementation (`packages/vault-crypto/scripts/gen-vectors.py`), so every expected value is already a cross-implementation check.

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
- Key add, rotation, or re-wrap flows (a later change).
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
  - Wrap AAD = fixed header (magic through wrapSalt) + that entry's credential ID. This prevents swapping entries between vaults or positions.
  - Payload AAD = all bytes preceding the payload nonce, so any edit invalidates decryption.
  - *Alternative rejected:* AAD over the whole blob via a hash. Simpler to reason about, but it leaves no way to identify which entry failed.
- **One PRF input, two HKDF derivations (single tap):** every ceremony evaluates only the global locator salt. From that output:
  - locator = HKDF(empty salt, info `cryoshield/v1/locator`);
  - wrapKey = HKDF(salt = the blob's per-vault wrap salt, info `cryoshield/v1/wrap`).

  The client holds the PRF output in memory while it fetches the blob by locator, then derives wrapKey with no second tap. The per-vault salt still makes wrapping keys unrelated across vaults that share a credential.
  - *Alternative rejected:* a second PRF input equal to the wrap salt. It needs two taps when the blob isn't cached, and gives no security gain because the wrap salt is public.
- **Shamir implementation:** the `shamir-secret-sharing` npm package (Privy), version pinned, with its share encoding fixed by our vectors. It is reportedly audited by Cure53 and Zellic; task 6.1 verifies those reports before use.
  - *Alternative rejected:* an in-house GF(2^8) implementation. Unaudited code in a security-critical path.
- **Squatting-tolerant lookup:** the contract's index maps a locator to an append-only, capped list of vaultIds. Locators are public once used, so anyone can append blobs under them. The library exposes `selectVault(candidates, prf)`, which tries each blob and returns the first whose wrapped-key unwrap authenticates. AES-GCM authentication makes forged candidates indistinguishable from noise, not dangerous.
- **Zeroization:** the library overwrites (`fill(0)`) every PRF output and derived-key `Uint8Array` it receives or creates, in `finally` blocks. JavaScript can't guarantee no copies remain (the garbage collector, WebCrypto internals), so this is best effort. The requirement still forbids persisting or logging these values.
- **Randomness injection:** every random draw (wrap salt, data key, nonces, Shamir coefficients) goes through an injectable RNG interface. Production uses WebCrypto, and tests use vector-supplied bytes.
- **Credential-ID cap of 128 bytes:** covers YubiKey resident and non-resident credentials. Encoders refuse anything longer.

## Threat / Abuse Considerations

- **Public ciphertext forever:** only AES-256 and HMAC-SHA256 are used, both considered quantum-resistant at this key size. The suite ID allows future versions; old blobs cannot be re-encrypted once they are public, which is accepted.
- **Nonce reuse:** every nonce is random 96-bit and every data key is fresh per encryption, so collision risk is negligible at this scale. Updating a vault re-encrypts with a new data key and new nonces.
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

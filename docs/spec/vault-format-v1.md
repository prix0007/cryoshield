# CryoShield Vault Format v1

Status: draft. It is normative once the first mainnet vault exists, and from then on it is frozen forever.
Changes: `add-vault-crypto-core` (archived), amended in place by `openspec/changes/bind-vault-id-to-ciphertext`.

> **Amendment note.** The vaultId binding (§4.1) was added to v1 before any v1 blob existed on any chain or on Arweave, so the version byte is still 0x01 and the vectors were regenerated. Once the first mainnet vault exists, a change like this requires a new version byte.
Reference implementation: `packages/vault-crypto` (TypeScript).
Normative test vectors: `packages/vault-crypto/test-vectors/v1.json`.

The key words MUST, MUST NOT, SHALL, SHOULD, and MAY are to be read as in RFC 2119.

This document plus the test vectors is enough to build an independent implementation, for example the Python desktop recovery tool. Where this text and the vectors disagree, the disagreement is a bug: report it rather than picking one.

---

## 1. Notation and primitives

- `||` is byte concatenation. `u8(n)` is one byte, and `u16be(n)` is two bytes, big-endian. All multi-byte integers are big-endian.
- `ASCII("...")` means the string's bytes, with no terminator.
- `SHA-256` is FIPS 180-4.
- `HKDF(ikm, salt, info, L)` is HKDF-SHA256 (RFC 5869), extract then expand.
  - An **empty salt** means a zero-length salt. Per RFC 5869 that is the same as a salt of 32 zero bytes.
- `AES-GCM-Enc(key, nonce, aad, pt)` is AES-256-GCM with a 96-bit nonce and a 128-bit tag. Its output is `ciphertext || tag`.
- `AES-GCM-Dec` either returns the plaintext or fails authentication.

Suite 0x01 uses only the primitives above. It MUST NOT use any public-key or elliptic-curve primitive.

## 2. Constants

| Name | Value |
|---|---|
| `MAGIC` | `ASCII("CRYO")` = `43 52 59 4f` |
| `VERSION` | `0x01` |
| `SUITE` | `0x01`: HKDF-SHA256 + AES-256-GCM |
| `MODE_ANY_OF_N` | `0x01` |
| `MODE_SHAMIR` | `0x02` (experimental; not in the default MVP flow) |
| `MAX_BLOB` | 1024 bytes |
| Key count N | 2..8 |
| `LOCATOR_SALT_INPUT` | `ASCII("cryoshield/v1/locator-salt")` |
| `INFO_LOCATOR` | `ASCII("cryoshield/v1/locator")` |
| `INFO_WRAP` | `ASCII("cryoshield/v1/wrap")` |

## 3. Single PRF input and CTAP salt mapping

There is exactly **one** PRF input for every credential and every vault. It is the global locator salt:

```
locatorSalt = SHA-256(LOCATOR_SALT_INPUT)      // 32 bytes
```

- **Browsers (WebAuthn PRF extension).** Evaluate with `prf: { eval: { first: locatorSalt } }`. No second input is used.
- **CTAP2 `hmac-secret` (desktop recovery).** The WebAuthn PRF extension hashes its input before passing it to the authenticator. A client talking CTAP2 directly MUST therefore use:

  ```
  ctapSalt = SHA-256(ASCII("WebAuthn PRF") || 0x00 || locatorSalt)
  ```

  With that salt, `hmac-secret` returns the same 32 bytes as the browser's PRF output. Both salts appear in every vector.

### 3.1 User verification is required

Every WebAuthn ceremony that evaluates the PRF MUST request `userVerification: "required"`. Every CTAP2 `hmac-secret` evaluation MUST be made with user verification (PIN or built-in UV).

The reason: a CTAP2 authenticator keeps two independent per-credential secrets, `CredRandomWithUV` and `CredRandomWithoutUV`, and the UV state of the ceremony selects one of them.
- If a browser used `"preferred"` and UV silently didn't happen, the vault would be bound to `CredRandomWithoutUV`.
- A desktop tool that always does UV would then get a different PRF output, and the vault could never be opened.

Fixing UV to "required" everywhere removes that split. Where the setting goes depends on the call:
- **`navigator.credentials.create()`** reads UV only from `authenticatorSelection.userVerification`, and ignores a top-level `userVerification` field. Registration MUST set `authenticatorSelection: { userVerification: "required", residentKey: "required" }`. The reference library's `webauthnPrfCreateOptions()` does this.
- **`navigator.credentials.get()`** takes a top-level `userVerification: "required"`. The reference library's `webauthnPrfGetOptions()` does this.

UV is a request, not a guarantee, so a client MUST also check the result. Before using any PRF output from `create()` or `get()`, the client MUST verify that the UV flag (bit 2, mask 0x04, of the flags byte at offset 32 of `authenticatorData`) is set. Otherwise it MUST discard the PRF output and fail with `USER_NOT_VERIFIED`. Authenticator data shorter than 37 bytes is `INVALID_ARGUMENT`. The reference library's `assertUserVerified(authenticatorData)` does this check; the vectors' `authenticatorDataCases` pin it.

### 3.1a UV enforced by the authenticator: credProtect level 3

UV-required options and the UV-flag check protect what *this client* does. They do not stop an attacker who holds a
key and runs their own client. The vault's credential IDs are public (they are stored in the blob), and the smart
wallet that verifies signing assertions does not require the UV flag and does not check `rpIdHash` or the origin
(audit AA-H1). So, unless the key itself refuses, one stolen key with no PIN can sign.

Every credential used for a vault MUST therefore be created with CTAP 2.1 **credProtect level 3**
(`userVerificationRequired`). At that level the authenticator returns no assertion for the credential, and does not
even reveal that it exists, unless user verification (the PIN or built-in UV) is performed, even when the caller names
its credential ID. In short: **UV is mandatory, and it is enforced by the authenticator via credProtect level 3.**
- **Request:** registration MUST set `extensions: { credentialProtectionPolicy: "userVerificationRequired",
  enforceCredentialProtectionPolicy: true }`. With enforcement, a browser fails `create()` rather than silently creating
  a weaker credential. The reference library's `webauthnPrfCreateOptions()` sets both.
- **Confirm:** before a new credential is used for a vault, the client MUST read the authenticator's extension output
  (the `credProtect` integer in the CBOR extensions map of the registration `authenticatorData`, present when the ED
  flag 0x80 is set) and require exactly 3. Browsers do not return this in `getClientExtensionResults()`. A missing,
  lower or unparsable value fails with `CRED_PROTECT_UNSUPPORTED`, and the key MUST NOT be enrolled. The reference
  library's `assertCredProtectUvRequired(authenticatorData)` does this.
- **Recovery tool:** CTAP2 `getAssertion` with `hmac-secret` and UV (PIN) works unchanged for level 3 credentials. The
  tool already always performs UV.
- **Residual risk:**
  - Keys enrolled before this rule may carry a lower level and MUST be re-created; the only such vault is the founder's
    test vault.
  - A contract-level fix (a validator that requires UV and checks `rpIdHash` and origin) is planned before mainnet, so
    the protection does not rest on the authenticator alone.
  - U2F/CTAP1 is not covered by credProtect on every key. Because the wallet ignores `rpIdHash` and UV, a U2F
    `AUTHENTICATE` signature (attacker-chosen challenge parameter) has the shape of a valid assertion. A key that
    accepts a CTAP2 credential ID over U2F could sign without its PIN. The UV-requiring validator closes this (U2F
    never sets UV), and that validator is a hard gate for mainnet.

## 4. Key derivation (single tap)

Each ceremony yields one 32-byte PRF output `prf` per credential. From it:

```
locator = HKDF(ikm = prf, salt = empty,    info = INFO_LOCATOR, L = 32)
wrapKey = HKDF(ikm = prf, salt = wrapSalt, info = INFO_WRAP,    L = 32)
```

- `locator` is public: it is the on-chain `bytes32` lookup key, and each enrolled key has its own. The client chooses a vaultId (§4.1) and registers it under the locators.
- `wrapSalt` is the per-vault 32-byte salt in the blob header (§5). It is generated by a CSPRNG for every new vault and is never sent to the authenticator.
- **Single-tap unlock:** the client keeps `prf` in memory, derives `locator`, fetches the candidate blobs, reads `wrapSalt` from each, and derives `wrapKey`, all with no second ceremony.

### 4.1 vaultId binding

Every blob is bound to the 32-byte `vaultId` it is registered under, so a byte-identical copy registered under any other `vaultId` (a clone) never authenticates.
- The `vaultId` is **not stored in the blob**. Every reader MUST supply it from where it found the blob: the registry's `vaultId` key, or the Arweave `CryoShield-Vault-Id` tag. It MUST NOT be taken from any data inside or next to the blob that an attacker could write.
- A `vaultId` MUST be exactly 32 bytes and not all zeros. Anything else → `INVALID_ARGUMENT`. Opening and adding check this before decoding; creating checks it right after the key-count checks.
- The `vaultId` enters both the wrap AAD (§6.3) and the payload AAD (§6.2). Opening under the wrong `vaultId` fails exactly like a wrong key: `NO_MATCHING_KEY`.
- The registry lets the client choose the `vaultId`, so it is known before encryption. If registration reverts because the `vaultId` is taken (for example, front-run), the client MUST create a new blob under a fresh `vaultId`. Because the wrap AAD binds the `vaultId`, that needs every key's PRF output again.

## 5. Byte layout

| Offset | Field | Size | Rules |
|---|---|---|---|
| 0 | magic | 4 | MUST be `CRYO` |
| 4 | version | 1 | MUST be 0x01 |
| 5 | suite | 1 | MUST be 0x01 |
| 6 | mode | 1 | 0x01 or 0x02 |
| 7 | threshold M | 1 | mode 0x01: M = 1; mode 0x02: 2 ≤ M ≤ N |
| 8 | count N | 1 | 2 ≤ N ≤ 8 |
| 9 | rpIdLen | 1 | 1..64 |
| 10 | rpId | rpIdLen | visible ASCII, 0x21..0x7E |
| 10+rpIdLen | wrapSalt | 32 | |
| H | entry[0..N-1] | variable | see below |
| P | payloadNonce | 12 | |
| P+12 | payloadCt | 64k + 16 | k ≥ 1; it runs to the end of the blob |

`H = 42 + rpIdLen` is the length of the **fixed header** (magic through wrapSalt).

Each entry is:

| Field | Size | Rules |
|---|---|---|
| credIdLen | 1 | 1..128 |
| credId | credIdLen | raw credential ID bytes. Credential IDs within a blob MUST be distinct. |
| wrapNonce | 12 | |
| wrapped | 48 (mode 0x01) / 49 (mode 0x02) | AES-GCM ciphertext and tag of a 32-byte data key, or of a 33-byte share |

The total blob length MUST be ≤ 1024 bytes. The order of entries is the enrollment order.

### 5.1 Decoding order and error codes

Decoders MUST check in this order and report the first failure with the code shown. Reading past the end of the input at any step is `MALFORMED`.

1. Length < 4 → `MALFORMED`; bytes 0..3 ≠ `CRYO` → `BAD_MAGIC`.
2. version ≠ 0x01 → `UNSUPPORTED_VERSION`.
3. suite ≠ 0x01 → `UNSUPPORTED_SUITE`.
4. mode ∉ {0x01, 0x02} → `UNSUPPORTED_MODE`.
5. Total length > 1024 → `MALFORMED`.
6. N ∉ 2..8, or M invalid for the mode → `MALFORMED`.
7. rpIdLen ∉ 1..64, or an rpId byte outside 0x21..0x7E → `MALFORMED`.
8. wrapSalt, then each entry: credIdLen ∉ 1..128, a duplicate credId, or a truncated field → `MALFORMED`.
9. Remaining bytes R after the entries: R < 12 + 80, or (R − 12 − 16) mod 64 ≠ 0 → `MALFORMED`.

There is no negotiation and no fallback: unknown versions, suites, and modes are rejected before any cryptographic operation.

## 6. Encryption

### 6.1 Payload padding

```
padded = u16be(len(secret)) || secret || zeros
len(padded) = 64 * ceil((2 + len(secret)) / 64)
```

- The secret is 1..65535 bytes; an empty secret is rejected with `INVALID_ARGUMENT`.
- After decryption, a length prefix > len(padded) − 2 or any nonzero pad byte → `MALFORMED`.
- Padding never pushes the blob past 1024 bytes: if the padded payload doesn't fit, creation fails with `VAULT_TOO_LARGE` (§7).

### 6.2 Envelope

```
dataKey      = 32 random bytes (fresh per vault; kept by updatePayload/addKey, see §6.6–6.7)
payloadNonce = 12 random bytes
payloadAad   = blob[0 .. P) || vaultId  // every byte before payloadNonce, then the 32-byte vaultId (§4.1)
payloadCt    = AES-GCM-Enc(dataKey, payloadNonce, payloadAad, padded)
```

The payload AAD covers the fixed header, every entry, and the `vaultId`. So any edit to the metadata or to the wrapped keys makes decryption fail, and so does moving the blob to another `vaultId`.

### 6.3 Wrap AAD and mode 0x01 (any-of-N)

Each entry i (0-based, in blob order) is bound to the vault's **immutable** fields, to the vault's `vaultId` (§4.1), and to its own identity:

```
wrapAad_i = MAGIC || u8(version) || u8(suite) || u8(mode)
            || u8(rpIdLen) || rpId || wrapSalt
            || vaultId                                   // 32 bytes, supplied by the reader
            || u8(i) || u8(len(credId_i)) || credId_i
```

The wrap AAD deliberately excludes the threshold M and the count N, so appending an entry (§6.6) leaves the existing wraps valid. Integrity of the whole blob, M and N included, comes from the payload AAD (§6.2).

In mode 0x01:

```
wrapped_i = AES-GCM-Enc(wrapKey_i, wrapNonce_i, wrapAad_i, dataKey)   // 48 bytes
```

N ≥ 2 is required at creation (`TOO_FEW_KEYS`); N > 8 is `TOO_MANY_KEYS`. Any single key opens the vault.

### 6.4 Mode 0x02: Shamir M-of-N (experimental)

This is the construction of `shamir-secret-sharing` 0.0.4:

- **Field:** GF(2^8) with reduction polynomial x⁸ + x⁴ + x³ + x + 1 (0x11B, the AES field). Addition is XOR.
- **Splitting:** for each byte `s_j` of `dataKey` (j = 0..31), a polynomial `f_j(x) = s_j + a_{j,1}·x + … + a_{j,M−1}·x^{M−1}` with uniformly random coefficients (zero allowed).
- **x-coordinates:** N distinct public values `x_i` ∈ 1..255.
- **Shares:** `y_{i,j} = f_j(x_i)`.
- **Wrapped share plaintext** (33 bytes): `u8(x_i) || y_{i,0} || … || y_{i,31}`. The x-coordinate comes first. The library's native layout is `y || x`, and implementations convert.

  ```
  wrapped_i = AES-GCM-Enc(wrapKey_i, wrapNonce_i, wrapAad_i, share_i)   // 49 bytes
  ```
- **Reconstruction:** Lagrange interpolation at x = 0, for each byte, over any M shares with distinct x. A share with x = 0 → `MALFORMED`.
- **Integrity:** the reconstructed key is authenticated only by payload decryption (`AUTH_FAILED` on mismatch).

### 6.5 Opening

Inputs: the blob, the `vaultId` it was read under, and one or more `(prf, optional credId)` keys.

1. Validate the `vaultId` (§4.1), then decode (§5.1).
2. For each key, derive `wrapKey` and try each entry, or only entries whose credId matches when one is given. A successful AES-GCM decrypt is an **unwrap**.
3. Mode 0x01: on the first unwrap, the plaintext is the data key.
   Mode 0x02: collect the distinct unwrapped entries.
   - 0 unwraps → `NO_MATCHING_KEY`;
   - fewer than M → `INSUFFICIENT_SHARES`;
   - otherwise combine the first M in entry order.
4. Decrypt the payload. A failure → `AUTH_FAILED`. Then strip the padding (§6.1).

If no entry unwraps in mode 0x01, the result is `NO_MATCHING_KEY`. Tampering inside a wrap AAD (an immutable header field, an entry's position or credId, or its wrapped key), or a wrong `vaultId`, is indistinguishable from a wrong key. Tampering with any other entry, or with M or N, is caught by the payload AAD (`AUTH_FAILED`). Error results MUST carry no further detail about which step failed.

### 6.6 Adding a key (mode 0x01 only)

Inputs: the blob, its `vaultId`, one enrolled key `(prf, optional credId)`, and the new credential `(credId_new, prf_new)`.

1. Validate the `vaultId` (§4.1) and decode the blob (§5.1), then refuse the add in these cases, in this order:
   - mode 0x02 → `INVALID_ARGUMENT`;
   - N + 1 > 8 → `TOO_MANY_KEYS`;
   - `credId_new` invalid or already present, or `prf_new` not 32 bytes → `INVALID_ARGUMENT`.
2. Open the vault with the enrolled key under the `vaultId` (§6.5). This yields `dataKey` and the secret, and errors propagate. If the resulting blob would exceed 1024 bytes → `VAULT_TOO_LARGE`.
3. Build the new header: identical except N + 1. Copy the existing entries byte for byte, and append entry N:
   ```
   wrapped_N = AES-GCM-Enc(HKDF(prf_new, wrapSalt, INFO_WRAP), fresh wrapNonce, wrapAad_N, dataKey)   // wrapAad_N includes vaultId
   ```
4. Re-encrypt the padded secret under the same `dataKey` with a fresh `payloadNonce` and the new payload AAD (the new `blob[0 .. P) || vaultId`). The new `payloadNonce` MUST differ from the blob's current one; an implementation that draws an equal nonce MUST abort.

Only one existing key is needed. The new key's locator (§4) must then be registered on chain by the caller.

### 6.7 Updating the payload

Open with any sufficient key set under the `vaultId` (§6.5). Then encrypt the new padded secret (§6.1) under the same `dataKey`, with a fresh `payloadNonce` (which MUST differ from the current one; abort otherwise) and with the unchanged header and entries, followed by the `vaultId`, as AAD. The size rules of §7 apply.

## 7. Size cap and capacity

```
overhead = H + Σ_i (1 + len(credId_i) + 12 + W) + 12 + 16      // W = 48 (0x01) or 49 (0x02)
maxPayloadBytes = 64 * floor((1024 − overhead) / 64) − 2      // 0 if negative
```

Encoders MUST refuse any secret longer than `maxPayloadBytes` with `VAULT_TOO_LARGE`, and the error MUST state that maximum.

Budget examples, for RP ID `cryoshield.app` (14 bytes) and 64-byte credential IDs:

| Mode | N | overhead | maxPayloadBytes |
|---|---|---|---|
| 0x01 | 2 | 334 | 638 |
| 0x01 | 3 | 459 | 510 |
| 0x02 | 3 | 462 | 510 |

## 8. Candidate selection (squatting)

A locator can resolve to several vaultIds, because the on-chain index is append-only and anyone can append to it. Each candidate is a pair `(vaultId, blob)`, where the blob is read from the registry under that `vaultId`. Given the candidates in index order and one PRF output, a client MUST:
1. skip any candidate that fails to decode;
2. accept the first candidate that opens completely under **its own** `vaultId` (§6.5): an unwrap authenticates **and** the payload authenticates;
3. ignore every other candidate without error. This includes a byte-identical clone of a genuine blob under an attacker's `vaultId`, which never authenticates (§4.1).

The client returns the first candidate that opens, with its index and `vaultId`, and tries no further candidates. All later updates MUST target that `vaultId`. If one key legitimately opens several vaults, the caller handles the duplicates. If no candidate opens, the result is `NO_MATCHING_VAULT`. Forged candidates can't authenticate without the wrapping key, so they cost only extra reads and decrypt attempts.

## 9. Handling secrets

- PRF outputs, wrapping keys, data keys, and Shamir shares MUST be kept in memory only, zeroized after use (success or failure), and never persisted, logged, or sent over the network.
- The reference library overwrites the caller's PRF buffers when `createVault`, `openVault`, `selectVault`, `addKey`, or `updatePayload` returns.
- The derivation helpers leave their input intact (the caller still needs it for the next step) but zeroize their intermediates.

## 10. Error codes

| Code | Meaning |
|---|---|
| `BAD_MAGIC` | the first 4 bytes are not `CRYO` |
| `UNSUPPORTED_VERSION` | the version byte is not 0x01 |
| `UNSUPPORTED_SUITE` | the suite byte is not 0x01 |
| `UNSUPPORTED_MODE` | the mode byte is not 0x01 or 0x02 |
| `MALFORMED` | a structural or length violation, or bad padding after decryption |
| `VAULT_TOO_LARGE` | the blob would exceed 1024 bytes (the message states maxPayloadBytes) |
| `TOO_FEW_KEYS` | N < 2 ("at least 2 keys required") |
| `TOO_MANY_KEYS` | N > 8 |
| `INVALID_ARGUMENT` | a bad rpId, credId, PRF length, threshold, or vaultId (not 32 bytes, or all zeros), or an empty secret; `addKey` on a mode 0x02 vault |
| `NO_MATCHING_KEY` | no entry unwraps under the supplied key(s) and `vaultId` (this includes a blob cloned under another vaultId) |
| `INSUFFICIENT_SHARES` | mode 0x02: at least 1 but fewer than M shares unwrapped |
| `AUTH_FAILED` | the payload failed authentication after a successful unwrap |
| `NO_MATCHING_VAULT` | no candidate opened |
| `USER_NOT_VERIFIED` | authenticatorData lacks the UV flag; the PRF output must not be used (§3.1) |
| `CRED_PROTECT_UNSUPPORTED` | a new credential did not confirm credProtect level 3; it must not be enrolled (§3.1a) |

## 11. Test vectors and randomness order (informative)

`test-vectors/v1.json` fixes every random value. Its schema is documented in `packages/vault-crypto/README.md`. To reproduce blobs byte for byte, the reference library draws randomness in this order:
1. `wrapSalt` (32);
2. `dataKey` (32);
3. `wrapNonce` for entries 0..N−1 (12 each);
4. `payloadNonce` (12).

`addKey` draws the new entry's `wrapNonce` (12), then `payloadNonce` (12). `updatePayload` draws `payloadNonce` (12).

In mode 0x02, the Shamir library draws separately: 255 coordinate-shuffle bytes, then M−1 coefficient bytes per data-key byte (the `shamirRng` stream).

This order is an implementation detail. Interoperability depends only on the byte layout.

---

## Requirement checklist

Each requirement in `openspec/changes/add-vault-crypto-core/specs/vault-crypto/spec.md` maps to these sections:

- [x] Versioned blob header → §2, §5, §5.1
- [x] Algorithm suite 0x01 → §1, §2
- [x] Blob size cap → §5, §7
- [x] Recorded relying-party and credential metadata → §5
- [x] Single PRF input → §3
- [x] Locator derivation → §4
- [x] Per-vault wrap salt → §4, §5
- [x] Wrapping-key derivation → §4
- [x] Envelope encryption of the payload → §6.2
- [x] Length-hiding padding → §6.1
- [x] Any-of-N unlock mode → §6.3, §6.5
- [x] Adding a key → §6.6
- [x] Updating the payload → §6.7
- [x] Shamir M-of-N unlock mode → §6.4, §6.5
- [x] Wrong key rejection → §6.5, §10
- [x] User verification required → §3.1
- [x] Single-tap unlock → §4
- [x] Vault ID binding → §4.1, §6.2, §6.3, §6.5–6.7, §8
- [x] PRF output handling → §9
- [x] Candidate vault selection → §8
- [x] Named error codes → §5.1, §10
- [x] Deterministic test vectors → §11

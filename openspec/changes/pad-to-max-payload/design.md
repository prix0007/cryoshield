# Design: pad every vault payload to the maximum

## Context

- Spec today (`docs/spec/vault-format-v1.md`):
  - §6.1: `padded = u16be(len) || secret || zeros`, `len(padded) = 64 × ceil((2 + len) / 64)`.
  - §7: `overhead = H + Σ(1 + len(credId) + 12 + W) + 12 + 16` with `H = 42 + rpIdLen`, and
    `maxPayloadBytes = 64 × floor((1024 − overhead) / 64) − 2`.
- Review F3 (`docs/reviews/on-chain-confidentiality-2026-10.md`): with two 64-byte credential IDs, the web app's
  payload for a 12-word seed is 138 bytes and gives a 526-byte blob; a 24-word seed is 232 bytes and gives 590 bytes.
- Option O3 (`docs/compliance/on-chain-minimisation-options.md`), accepted by the founder on 2026-10-10.

## Goals / Non-Goals

- **Goal:** the blob length is a function of public data only (RP ID, credential-ID lengths, N, mode).
- **Goal:** every existing blob still decodes and opens in both implementations.
- **Non-goal:** hiding N, the credential-ID lengths, the number or timing of writes (see Threat model).
- **Non-goal:** F2 (D6).

## Decisions

### D1. Target length: `64 × floor((1024 − overhead) / 64)`, not exactly 1024

```
target    = 64 × floor((1024 − overhead) / 64)        // = maxPayloadBytes + 2
padded    = u16be(len(secret)) || secret || zeros, len(padded) = target
blobLen   = overhead + target                          // 960 < blobLen ≤ 1024 whenever a secret fits
```

Keeping the 64-byte granularity and stopping short of 1024 is deliberate:

- **It already hides everything.** `overhead` is public, so `target` is public; filling the remaining 0..63 bytes
  would hide nothing more.
- **Exactly 1024 would break every deployed decoder.** Spec §5 / §5.1 step 9 require the payload ciphertext to be
  `64k + 16` bytes. A blob filled to 1024 bytes has `(1024 − overhead − 28) mod 64 ≠ 0` for most key sets, so the
  TypeScript library, the shipped recovery tool and any third-party reader would reject it as `MALFORMED`. That
  would need a new version byte (D2) for no privacy gain.
- **It costs less.** Up to 63 fewer calldata and storage bytes per write.

The capacity rule (`maxPayloadBytes`) does not change, so the UI's space-left figure and every refusal stay the same.

### D2. Format version stays 0x01; the rule is an encoder MUST

- The byte layout, the AAD, the nonces, the key schedule and every decoder check are unchanged. A maximum-padded blob
  is a valid v1 blob under the existing decoders (both implementations, verified on the new vectors before any decoder
  code was touched: task 2.6), and every legacy blob stays valid.
- A new version byte would force every reader to accept two versions that differ only in how much zero padding the
  writer chose, and would give old testnet blobs a different version from new ones for no reason.
- So the spec makes maximum padding an **encoder MUST** and tells decoders they **MUST NOT** require it. Following the
  vaultId-binding precedent, the amendment is made in place before the first mainnet vault (spec header note).
- Consequence: a non-conforming third-party encoder could still write short padding, and the library would open it.
  That leaks only that writer's own user's size class, never anyone else's.

### D3. Every write path, enumerated

| Path | Where | Key set it pads for |
|---|---|---|
| Create | `createVault` (vault-crypto); web `createVaultBlob` | the N new credentials |
| Edit items, rename, archive, unarchive | `updatePayload`; web `editVaultBlob`, `saveVaultMeta` | the blob's current entries |
| Archive and clear (payload v2 §8) | `updatePayload` via web `clearVaultBlob` | the blob's current entries |
| Add key | `addKey`; web `addKeyToBlob` | the N + 1 entries (smaller maximum; `VAULT_TOO_LARGE` if the secret no longer fits) |
| Remove key / clear vault | none exist in the format, library or app | n/a |
| Recovery tool | never writes (only `tests/support/writer.py`, test-only, updated to match) | n/a |
| Vector generators | `scripts/gen-vectors.py` (independent Python), `gen-payload-vectors.py` (uses it) | as the library |

`encodeVault` serialises given fields and never pads, so it is not a write path. Padding lives in one function
(`pad(secret, target)`), and the three library entry points compute `target` from the key set of the blob they are
about to write. The web app needs no call-site change, and a test pins that its three writers produce maximum-padded
blobs (task 3.1).

**Archive and clear** keeps its payload-level `z` sizing (`docs/spec/payload-v2.md` §8). With maximum padding the
blob length no longer depends on the payload, so `z` is redundant for length hiding but harmless: it is inside the
padded plaintext, and the cleared payload never exceeds `maxPayloadBytes` (checked already). Changing the payload
format is out of scope.

### D4. Decoder compatibility, verified

- TypeScript `decodeVault` (`format.ts`) accepts any remainder `R ≥ 92` with `(R − 28) mod 64 = 0`; `unpad`
  (`padding.ts`) rejects a length prefix above `len − 2` and ORs every pad byte, then rejects nonzero (`MALFORMED`).
- Python `decode_blob` (`tools/recover/.../format.py`) has the same remainder check; `vault._unpad` has the same two
  checks.
- Proven by vectors rather than reading: before the encoders changed, both decoders opened the maximum-padded vectors
  (task 2.6), and `legacyPaddingCases` (byte-identical to the blobs of the previous `v1.json`, SHA-256-pinned in the
  generator) open in both. New open cases `nonzero-pad-byte` and `length-prefix-overrun` are authenticated payloads
  with bad padding, so the checks after decryption are exercised in both languages.

### D5. Vectors

`test-vectors/v1.json` is regenerated (the encoder contract changed). Additions:

- `vaults`: `any-of-2-12-word`, `any-of-3-12-word`, `any-of-3-24-word`, `shamir-2-of-3-12-word`,
  `shamir-2-of-3-24-word`; each vault records `paddedLength`.
- `lengthHidingCases`: three groups (any-of-2: 12 words, 24 words, 638-byte max; any-of-3: 12 words, 24 words, TOTP
  codes; shamir-2-of-3: 12 words, 24 words, a 28-byte phrase), each with one `blobLength`, `overhead` and
  `paddedLength`.
- `addKeyCases`: `add-C-with-A` now re-pads from 640 to 576 bytes; new `add-C-to-legacy`. Success cases record
  `expectedBlobLength` (already) and `expectedPaddedLength`.
- `updatePayloadCases`: new `update-legacy-to-max`; success cases record `expectedBlobLength`.
- `openCases`: `nonzero-pad-byte`, `length-prefix-overrun` (`MALFORMED`).
- `legacyPaddingCases`: the previous file's four vault blobs, its `add-C-with-A` result and its `update-with-B`
  result, with the keys and `vaultId` that open them.

The previous `v1.json` had SHA-256 `f9a9ee670d5c83663281c3184d237888255eee79ef5944d0f214c2b31b611bad`.
`docs/spec/payload-vectors.json` is regenerated because its blob vectors encrypt through `gen-vectors.py`.

### D6. Review F2 (payload-nonce derivation): status and interaction

- **Status: open, undecided.** F2 (LOW) notes that `drawFreshPayloadNonce` only refuses the *current* nonce, while
  earlier versions under the same data key are public. Nothing in the repository implements or decides it.
- **Not entangled.** Padding changes the plaintext length only; nonce generation, AAD and keys are untouched. A
  nonce repeat is as harmful before and after (the XOR of two padded plaintexts, plus GHASH-key recovery). This change
  does not implement F2.
- **Caution for whoever decides F2.** The review suggests `nonce = HKDF(dataKey, "payload-nonce" ‖ u32be(version))`
  with the registry version. A deterministic nonce keyed only by the version **repeats** whenever two different
  plaintexts are encrypted for the same next version: a save that reverts or is not included and is then retried with
  edited items, a STALE retry, or two tabs. The calldata of a reverted transaction, and a user operation sent to the
  bundler, are public, so that would turn a theoretical risk into a practical nonce reuse. A synthetic nonce (for
  example `HMAC(K_nonce, random ‖ padded)` truncated to 96 bits, or AES-GCM-SIV) avoids that. Like this change, any
  F2 fix is encoder-only and keeps the version byte, because the nonce is stored in the blob. Flagged to the
  overwatcher.

### D7. Gas and cost

Measured, not estimated, wherever possible (the earlier draft's "+$0.0002 per edit" figure assumed registry storage
only; the full-stack measurement below supersedes it):

- **Registry, forge** (`snapshots/VaultRegistryV2.json`, full tx, isolated): `createVault` 526 B → 974 B: 616,314 →
  934,241 gas (+317,927); `updateVault` 526 B → 974 B: 127,700 → 206,228 gas (+78,528). The 1024-byte figures
  (957,198 / 212,084) are the ceiling. Almost all of the difference is storage: 14 more 32-byte slots.
- **Full stack, anvil** (`apps/web/test-int/gas.int.test.ts`, EntryPoint v0.6, software P-256): create with a
  12-word seed 1,259,328 → 1,618,847 gas (489 → 1,001 B), edit 455,258 → 548,707; 24-word create 1,306,516 →
  1,615,457 (553 → 1,001 B), edit 465,571 → 551,609. About 702 gas per added byte for create and 183 for edit.
- **OP Mainnet fees** (read 2026-10-09 21:04 UTC, block 157,990,537): L2 gas price 1,000,774 wei, L1 base fee
  0.104 gwei, blob base fee 0.0056 gwei, ETH $2,479.03 (Chainlink). `getL1FeeUpperBound` for the measured bundle sizes
  plus 576 bytes (a 442 → 1018-byte blob, the founder's real key shape): create 3.545e10 → 4.236e10 wei, edit
  2.809e10 → 3.503e10 wei (+6.9e9 wei ≈ $0.000017 each).
- **Result** (founder's key shape, 442 → 1,018 B): create 987,350 → ~1,391,809 L2 gas, $0.00254 → $0.00356
  (**+$0.0010**, once per vault); edit 236,716 → ~341,846, $0.00066 → $0.00093 (**+$0.00028**). The overwatcher's
  "well under $0.001 per save" holds for edits; a create is about $0.001 more. With Pimlico's $0.0105 fee per
  operation the totals are about $0.0144 per create and $0.0115 per edit. The $0.50 per-operation cap (9× headroom at
  a ×10 spike), the $1 per-user cap and the registry's 1024-byte limit hold; the global $30 daily cap during a ×10
  spike was already the tightest case and is reached about 70 creates earlier (costs.md).

## Threat model

| Threat | Before | After |
|---|---|---|
| Observer infers the secret's size class (12 vs 24 words, one vs several items) from the blob length | possible (F3) | **removed**: length depends on public data only |
| Observer infers that a vault was cleared or shrunk from a shorter new version | possible (payload v2 `z` kept the length for Archive and clear only) | removed for every edit |
| Observer infers the exact length | hidden (64-byte steps) | hidden |
| Tampered padding used as an oracle | `MALFORMED` only after a successful AEAD decryption, so only the key holder reaches it | unchanged |

**Still public**, by design: the key count N and the mode (header), every credential-ID length (and the IDs), the RP
ID, the number of versions and the block time of each write, which key set existed at each version (add-key changes
N), and that a blob was written by a pre-change encoder (shorter than the maximum). Existing testnet vault histories
keep their old lengths forever.

## Risks / Trade-offs

- **More gas per write** (D7). Accepted by the founder; costs.md quantifies it.
- **Add-key can now fail later than before?** No: the refusal rule (`secret > maxPayloadBytes(N + 1)`) is unchanged;
  only the padded length changes.
- **Arweave mirror:** items grow to at most 1024 bytes, still far under Turbo's free-upload size.

## Security review

See tasks.md section 6; the record is below once done.

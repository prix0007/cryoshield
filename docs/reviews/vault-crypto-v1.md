# Security review: vault-crypto v1

| | |
|---|---|
| Change | `openspec/changes/add-vault-crypto-core` (task 8.2; Shamir diff, task 8.3) |
| Scope | `packages/vault-crypto` (src, tests, `test-vectors/v1.json`, `scripts/gen-vectors.py`), `docs/spec/vault-format-v1.md`, `docs/reviews/shamir-dependency.md` |
| Reviewer | security-reviewer agent (`ecc:security-reviewer`); findings relayed by the overwatcher |
| Verdict | **APPROVE**: no CRITICAL or HIGH findings |
| Fixes applied by | crypto-engineer, test first; all tests green in Node and Chromium |

## Checks performed

| Area | Result |
|---|---|
| **Nonces** | Every wrap nonce and payload nonce is a fresh random 96-bit draw from the injectable RNG (WebCrypto by default). The data key is fresh per vault. `updatePayload` and `addKey` keep the data key and draw a new payload nonce. Collision risk is negligible; a defensive equality check was added (L-2). |
| **AAD tamper matrix** | <ul><li>Wrap AAD = immutable header fields + entry index + credId. Flipping rpId, wrapSalt, or a credId, or swapping entries, gives `NO_MATCHING_KEY`.</li><li>Payload AAD = every byte before the payload nonce. Tampering with another entry, or with the nonce or ciphertext, gives `AUTH_FAILED`; M and N are covered here.</li><li>A unit test flips every pre-payload byte, and every flip is detected.</li></ul> |
| **HKDF separation** | Locator: empty salt, info `cryoshield/v1/locator`. Wrap key: per-vault salt, info `cryoshield/v1/wrap`. The info strings are distinct and versioned. There is one PRF input, and the CTAP salt mapping is pinned by the vectors. |
| **Parser** | Every length is bounds-checked before it is read, in the order of spec §5.1. The 1024-byte cap and the 64k+16 ciphertext rule are enforced. 10k-run fuzz properties show only `VaultError` is ever thrown. |
| **`selectVault`** | Accepts a candidate only after a full open (unwrap + payload). Forged-entry and replayed-header junk is skipped, and an empty list gives `NO_MATCHING_VAULT`. Returns the first match only (L-3). |
| **Shamir 0.0.3 → 0.0.4 diff** | Revert `3333451` restores uniformly random coefficients (zero allowed), which is the correct Shamir construction; the earlier forced-nonzero coefficient leaked one excluded value per byte to t−1 shares. `955bf20` is a comment only (the shuffle bias concerns public x-coordinates). The npm tarball's `src/` is byte-identical to tag `v0.0.4`. **Conclusion: correct.** |
| **Supply chain** | Runtime deps are pinned exactly: `@noble/hashes` 2.4.0, `@noble/ciphers` 2.4.0, `shamir-secret-sharing` 0.0.4. All dev deps are pinned exactly. `pnpm-lock.yaml` carries sha512 integrity hashes, e.g. shamir `sha512-ui8u/cIg2j16b9on/…XLQ==`. No install scripts in the runtime deps. |
| **Zeroization / logging** | PRF buffers are wiped in `finally` by every consuming function. Tests check them on success and on failure. A grep test finds no console, storage, or network APIs in `src/`. |
| **Error oracles** | Fixed messages per code; no step detail beyond `NO_MATCHING_KEY` vs `AUTH_FAILED`. |

## Findings and fixes

| ID | Severity | Finding | Fix | Test |
|---|---|---|---|---|
| M-1 | MEDIUM | `webauthnPrfRequest()` put `userVerification` at the top level, which `navigator.credentials.create()` ignores. A PIN-less key with hmac-secret-mc could return a non-UV PRF output at create, and the vault would then never open under a UV `get()`. | <ul><li>Split into `webauthnPrfCreateOptions()` (`authenticatorSelection: { userVerification: "required", residentKey: "required" }` + PRF) and `webauthnPrfGetOptions()` (top-level UV + PRF).</li><li>Added `assertUserVerified(authenticatorData)` (UV flag, bit 2; `USER_NOT_VERIFIED`).</li><li>The spec SHALLs that it is called before using any PRF output; there is a new scenario and new `authenticatorDataCases` vectors.</li></ul> | `test/review-fixes.test.ts`, `test/vectors.test.ts` |
| L-1 | LOW | Spec §6.2 said "dataKey fresh … per update", but updates keep the DEK. | The text now says the data key is fresh per vault and kept by `updatePayload`/`addKey`, with a fresh nonce. | n/a (docs) |
| L-2 | LOW | `replayRng` was exported from the production entry point. | Moved to the `@cryoshield/vault-crypto/testing` subpath export. | `review-fixes.test.ts` |
| L-2b | LOW | `updatePayload`/`addKey` re-encrypt under the same DEK with no check against nonce reuse. | Both now throw if the drawn payload nonce equals the current one; the spec §6.6/§6.7 MUSTs this. | `review-fixes.test.ts` |
| L-3 | LOW | Undocumented that `selectVault` returns only the first authenticating candidate. | Documented in the JSDoc, README, and spec §8: first match plus index, and the caller handles duplicates. | n/a (docs) |
| L-4 | LOW | README didn't say the caller must wipe the PRF if the fetch fails after `deriveLocator`. | README unlock example and security notes updated (`prf.fill(0)` on fetch failure). | README doctest |

All CRITICAL/HIGH findings: none. All MEDIUM and LOW findings above are resolved.

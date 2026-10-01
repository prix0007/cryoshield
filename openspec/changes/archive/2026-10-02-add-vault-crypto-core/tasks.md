# Tasks

## 1. Package scaffolding

- [x] 1.1 Create `packages/vault-crypto` (TypeScript, ESM, strict) with Vitest, and add `@noble/hashes`, `@noble/ciphers`, and `shamir-secret-sharing` (exact pinned version) as the only runtime deps. Verify that `pnpm --filter vault-crypto test` runs an empty suite green and `package.json` lists no other runtime deps.
- [x] 1.2 Add an injectable RNG interface (WebCrypto default, deterministic test RNG). Verify a unit test shows the test RNG replays supplied bytes in order and fails loudly when exhausted.

## 2. Spec document and test vectors (written before implementation)

- [x] 2.1 Write `docs/spec/vault-format-v1.md` with the byte layout, the single-PRF-input derivations, the PRF-to-CTAP salt mapping for the global salt, AAD rules, padding, and candidate selection from design.md. Verify that every spec requirement maps to a section (checklist in the doc).
- [x] 2.2 Author `packages/vault-crypto/test-vectors/v1.json`: fixed PRF outputs, salts, nonces, and data keys, plus expected locators, wrapping keys, and full encoded blobs for mode 0x01 (2 and 3 keys) and mode 0x02 (2-of-3). Generate the expected values with an independent Python script (`scripts/gen-vectors.py`, using the `cryptography` library). Verify the script regenerates byte-identical JSON.
- [x] 2.3 Add negative vectors: tampered header byte, tampered wrapped key, wrong key, insufficient shares, oversize payload, unknown version/suite/mode, truncated blob. Add a candidate-list vector (one genuine blob among junk blobs under the same locator, and a list with no genuine blob). Verify each has an expected result or error code.
- [x] 2.4 Add the vector-runner test harness. Verify it loads v1.json and every case fails (red) before implementation.

## 3. Derivations

- [x] 3.1 Implement `locatorSalt()`, `deriveLocator(prfOut)` (HKDF, empty salt), and `deriveWrapKey(prfOut, wrapSalt)` (HKDF, salt = wrap salt), all from one PRF output. Verify the locator and wrap-key vectors pass.
- [x] 3.2 Implement `ctapSalt()` = SHA-256("WebAuthn PRF" || 0x00 || locatorSalt()), the only PRF input. Verify the CTAP-salt vector field passes.
- [x] 3.3 Zeroize PRF outputs and derived keys in `finally` blocks across all public functions. Verify a test that inspects caller-supplied buffers after success and after failure finds all zeros, and a grep check that no code path logs or stores them.

## 4. Encoding / decoding

- [x] 4.1 Implement the bounds-checked decoder for the v1 layout. Verify decoder vectors pass, plus the unknown-version, -suite, and -mode and truncated-blob negative vectors.
- [x] 4.2 Implement the encoder with the 1024-byte cap and `maxPayloadBytes(rpId, credIds, mode)`. Verify round-trip tests and the oversize vector (error states the max payload size).
- [x] 4.3 Add a fast-check property test: decode(encode(x)) == x for random valid inputs, and random byte strings never crash the decoder (only typed errors). Verify 10k runs pass.

## 5. Any-of-N encryption (mode 0x01)

- [x] 5.1 Implement payload padding (2-byte length prefix, zero-pad to a multiple of 64) and AES-256-GCM payload encryption with the header AAD. Verify the padding-length test (10-byte and 40-byte secrets give equal ciphertext length) and the header-tamper vector.
- [x] 5.2 Implement `createVault({rpId, credentials[{id, prf}], secret})` for mode 0x01 (one PRF output per key), returning the blob and each key's locator, and refusing N < 2 and N > 8. Verify mode 0x01 vectors reproduce byte-identical blobs and the single-key refusal test passes.
- [x] 5.3 Implement `openVault(blob, {credId?, prf})`: try the matching entry (or all entries) and return the plaintext or "no matching key". Verify the either-key-unlocks, wrong-key, and tampered-wrapped-key vectors.
- [x] 5.4 Implement `selectVault(candidates[], prf)`: decode each candidate, skip malformed ones, and return the first that authenticates, or "no matching vault". Verify the squatted-locator and no-candidate vectors.

- [x] 5.5 Implement `addKey(blob, existingKey, newCredential)` for mode 0x01 (wrap AAD binds only immutable fields plus index and credId; append the entry; re-encrypt the payload under the same DEK with a fresh nonce). Verify the add-key vector (byte-identical), the opens-with-each-key test, the byte-identical-existing-entries test, and the refusal vectors (9th key, duplicate credId, mode 0x02, oversize).
- [x] 5.6 Implement `updatePayload(blob, keys, newSecret)`: same DEK, fresh payload nonce, header unchanged. Verify the update vector (byte-identical) and that every enrolled key opens the result and gets the new secret.

## 6. Shamir M-of-N (mode 0x02)

- [x] 6.1 Verify the `shamir-secret-sharing` audits before use: locate the Cure53 and Zellic reports, confirm they cover the pinned version, and record the findings and their resolution in `docs/reviews/shamir-dependency.md`. If either audit can't be confirmed, stop and escalate before 6.2.
- [x] 6.2 Wrap the package behind a share-codec adapter with injectable randomness for vectors. Verify the Shamir unit vectors and a property test showing every M-subset of N reconstructs and M-1 shares fail.
- [x] 6.3 Wire mode 0x02 into create/open, accepting multiple PRF outputs. Verify the 2-of-3 vectors, plus the threshold-met and insufficient-shares scenarios.

## 7. Documentation

- [x] 7.1 Write `packages/vault-crypto/README.md` with the API, the size budget table, and a "reimplementing the format" section pointing to the spec and vectors. Verify the README code examples compile in a doctest (`vitest --typecheck` on extracted snippets).

## 8. Integration and review

- [x] 8.1 Run the full suite in Node and in a headless browser (Vitest browser mode, Chromium). Verify all vectors pass in both environments.
- [x] 8.2 Security review: run the `ecc:security-reviewer` agent over `packages/vault-crypto`, the spec, and the vectors, with a checklist covering nonce handling, AAD coverage, bounds checks, RNG use, Shamir dependency and adapter, zeroization, candidate selection under squatting, error-oracle leakage, and dependency pinning. Verify all CRITICAL/HIGH findings are resolved and the review is recorded in `docs/reviews/vault-crypto-v1.md`.
- [x] 8.3 Shamir dependency diff review (security-reviewer): diff `shamir-secret-sharing` 0.0.3 against the pinned 0.0.4 (revert `3333451` of the PVY-01-002 fix, and `955bf20`). Confirm that uniformly random coefficients (zero included) give perfect secrecy for t−1 shares, that the biased x-coordinate shuffle doesn't matter for security, and that the published tarball matches the upstream tag. Verify the conclusion is recorded in `docs/reviews/shamir-dependency.md`.

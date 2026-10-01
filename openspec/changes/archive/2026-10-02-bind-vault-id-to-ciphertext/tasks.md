# Tasks

## 1. Vectors first

- [x] 1.1 Update `packages/vault-crypto/scripts/gen-vectors.py`:
  - add the `vaultId` to the wrap AAD (after wrapSalt) and to the payload AAD (appended);
  - give each vault vector a fixed `vaultId`, and give every open, add-key, update, and select case one;
  - add `wrong-vault-id` and `shamir-wrong-vault-id` (both `NO_MATCHING_KEY`), a positive open per mode, `invalid-vault-id` refusals, and select cases with a cloned blob under an attacker `vaultId`.

  Verify that `--check` regenerates byte-identical JSON.
- [x] 1.2 Update the vector runner and unit tests to the new API shapes. Verify they fail (red) against the old implementation.

## 2. Library

- [x] 2.1 Bind `vaultId` in the wrap AAD and the payload AAD. Add `vaultId` to `createVault`, `openVault`, `selectVault` (`{ vaultId, blob }` candidates, returning `vaultId`), `addKey`, and `updatePayload`, with 32-byte/non-zero validation. Verify all vectors pass, including the wrong-vaultId and cloned-candidate cases, in Node and in Chromium.
- [x] 2.2 Add unit tests: a clone under another `vaultId` fails for open, add-key, and update; an invalid `vaultId` is rejected. Verify they pass, and that zeroization tests still pass with the new signatures.

## 3. Documentation

- [x] 3.1 Update `docs/spec/vault-format-v1.md` (AADs, vaultId supply rule, selection, add/update, threat note, in-place amendment note) and `packages/vault-crypto/README.md` (signatures, examples, vector schema). Verify the README doctest compiles and the spec checklist maps the new requirement.

## 4. Review

- [x] 4.1 Security review: run the `ecc:security-reviewer` agent over the diff, covering vaultId placement in both AADs, the clone and front-run analysis, the tamper matrix, the vector coverage, and the API misuse risk (a wrong `vaultId` source). Verify all CRITICAL/HIGH findings are resolved and the review is recorded in `docs/reviews/bind-vault-id.md`.

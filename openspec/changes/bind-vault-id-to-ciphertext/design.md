# Design

## Context

The vault registry stores opaque blobs under client-chosen `vaultId`s, and indexes them by public locators (append-only, at most 16 entries per locator). The vault-crypto v1 format, as archived in `add-vault-crypto-core`, authenticated each blob only against itself.

The web-app security review (HIGH) showed that a byte-identical copy registered under another `vaultId` decrypts just as well as the original. Nothing is deployed yet, so v1 can still change.

## Goals / Non-Goals

**Goals:**
- A blob authenticates only under the `vaultId` it was created for.
- No new on-chain or blob storage.
- Readers get the `vaultId` from the same place they got the blob.

**Non-Goals:**
- Preventing the copy itself: the registry stays blob-agnostic and anyone can still write anything.
- Changing locator semantics.
- Hiding `vaultId`s, which are public.

## Decisions

- **Bind in both AADs; don't store the vaultId in the blob.**
  - The wrap AAD becomes `magic || version || suite || mode || u8(rpIdLen) || rpId || wrapSalt || vaultId || u8(index) || u8(credIdLen) || credId`.
  - The payload AAD becomes `blob[0 .. P) || vaultId`.
  - Leaving it out of the blob costs nothing (the reader always knows where it read from) and saves 32 bytes of the 1024-byte budget.
  - *Alternative rejected:* storing the vaultId in the header. Readers would then have to compare the stored id with the registry key, an easy check to forget. AAD binding enforces it by construction.
  - *Alternative considered:* binding the payload AAD only. That alone already defeats cloning: unwrap succeeds, the payload fails, and the candidate is skipped. It would also let a front-run retry re-bind with one key (see the risks below). The overwatcher decided on both AADs, for defense in depth: an entry can't be authenticated outside its vault even before the payload is checked.
- **Placement in the wrap AAD:** after `wrapSalt`. This keeps all per-vault fields together, followed by the per-entry fields (index, credId). `addKey` uses the same `vaultId`, so appending still leaves the existing wraps valid.
- **Wrong vaultId → `NO_MATCHING_KEY`.** It is cryptographically indistinguishable from a wrong key: no entry unwraps. No new error code is needed, and none could be reported honestly.
- **Validation:** the `vaultId` must be exactly 32 bytes and not all zeros (`INVALID_ARGUMENT`). That matches the registry, which rejects a zero `vaultId`.
- **API:**
  - `createVault({ vaultId, rpId, credentials, secret, mode?, threshold? }, { rng? })`;
  - `openVault(blob, keys, vaultId)`;
  - `selectVault(candidates: { vaultId, blob }[], prf) → { index, vaultId, secret }`;
  - `addKey(blob, existingKey, vaultId, newCredential, { rng? })`;
  - `updatePayload(blob, keys, vaultId, newSecret, { rng? })`.

  Here `vaultId` follows the unlocking key(s); for `createVault` it is part of the params.
- **Amend v1 in place:** the version byte stays 0x01, and the spec doc and vectors are regenerated. This is only allowed because no v1 blob exists anywhere yet. The proposal records it, and the format is frozen at the first mainnet vault.
- **Vectors:** each vault vector gets a fixed `vaultId` (derived deterministically from a label). All open, add-key, update, and select cases carry a `vaultId`.
  - New cases: `wrong-vault-id` (mode 0x01) and `shamir-wrong-vault-id` (mode 0x02), both expecting `NO_MATCHING_KEY`; positive cases per mode with the correct `vaultId`; a select case with a cloned blob under an attacker `vaultId` listed first, plus a clone-only case expecting `NO_MATCHING_VAULT`.
  - Decode cases are unchanged, since the layout is unchanged.

## Threat / Abuse Considerations

- **Blob cloning (the HIGH finding):** an attacker copies the victim's blob into their own `vaultId`, under the victim's locators.
  - With binding, the copy fails authentication under the attacker's `vaultId`, so `selectVault` skips it, and the client never writes updates into it.
  - The recovery tool reads `vaultId` from the registry (or the Arweave tag) alongside the blob, so a stale clone never decrypts either.
- **Clone plus false vaultId claim:** the attacker can't make a reader use the victim's `vaultId` for the attacker's storage slot. Readers take the `vaultId` from the registry key or the Arweave tag, not from attacker-supplied data.
  - An Arweave mirror entry tagged with the victim's `vaultId` but holding the victim's (old) blob is a rollback risk. That is out of scope here and is handled by the L1 hash anchoring and the registry `version`.
- **Front-running a registration:** a front-runner can copy a pending `vaultId` so that the victim's `createVault` reverts. Because the blob is bound to that `vaultId`, the retry must produce a **new blob**, and since the wrap AAD binds `vaultId`, **every key must tap again**. This is griefing, not compromise.
  - *Mitigations (not in this change):* retry with a fresh random `vaultId`. Alternatively, the registry could derive or require `vaultId = keccak256(msg.sender, salt)`, so a front-runner's copy lands on a different id; that is recommended for the contract team.
  - Binding the payload AAD only would cut a retry to a single tap. That option was weighed and declined (see Decisions).
- **Downgrade / format confusion:** none. The layout is unchanged, and an old-style blob (pre-amendment) simply fails to authenticate. None exist.
- **Tamper matrix (unchanged otherwise):** a wrong `vaultId` gives `NO_MATCHING_KEY`; header, credId, or own-entry tampering gives `NO_MATCHING_KEY`; other-entry, nonce, or ciphertext tampering gives `AUTH_FAILED`.

## Risks / Trade-offs

- [Breaking API for the frontend and the recovery tool] → The exact new signatures are reported to both teams. Old call shapes fail type checking.
- [A front-run retry needs N taps] → Documented above; the contract-side mitigation is recommended.
- [All vector blobs change] → Regenerated by `scripts/gen-vectors.py`, and verified byte-identical in TypeScript and Python.

## Migration Plan

Nothing is deployed, so nothing needs migrating. The spec, library, and vectors move together in this change.

## Open Questions

- Should the registry enforce `vaultId = keccak256(msg.sender, salt)` to stop front-run griefing? That belongs to the contract team, as a separate change.

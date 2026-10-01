# Proposal

## Why

The web-app security review found a HIGH issue: blob cloning.

`VaultRegistry.createVault` accepts any blob under any locators, and blobs and locators are public. So an attacker can copy a victim's blob, byte for byte, into a new vault they own and register it under the victim's locators. Today both vaults decrypt with the victim's key, so:
- `selectVault` may pick the attacker's copy;
- the victim may write updates into the attacker-controlled vault (which the attacker can later freeze or roll back);
- the recovery tool may show a stale clone.

The fix is to bind each blob cryptographically to the on-chain `vaultId` it was created for. A copy under any other `vaultId` then fails authentication and is skipped.

## What Changes

- The 32-byte `vaultId` is bound into **both** AADs:
  - the per-entry **wrap AAD**: `… || wrapSalt || vaultId || u8(index) || u8(credIdLen) || credId`;
  - the **payload AAD**: `blob[0 .. P) || vaultId`.
- The `vaultId` is **not stored in the blob**. The reader supplies it from wherever it found the blob: the registry's `vaultId`, or the Arweave `CryoShield-Vault-Id` tag.
- `vaultId` MUST be 32 bytes and non-zero (it matches the registry's `bytes32`, which rejects zero).
- An opener given the wrong `vaultId` fails exactly as with a wrong key (`NO_MATCHING_KEY`). Candidate selection pairs each candidate blob with its `vaultId` and skips mismatches.
- **Library API (breaking):**
  - `createVault({ vaultId, … })`;
  - `openVault(blob, keys, vaultId)`;
  - `selectVault(candidates: { vaultId, blob }[], prf)`, which now also returns the selected `vaultId`;
  - `addKey(blob, existingKey, vaultId, newCredential)`;
  - `updatePayload(blob, keys, vaultId, newSecret)`.
- **Format v1 is amended in place.** No vault exists on any chain or on Arweave yet: the contract is not deployed and the format is not frozen. So the version byte stays 0x01, the spec document is updated, and `test-vectors/v1.json` is regenerated.
  - After the first mainnet vault, a change like this would need a new version byte.
- New vectors:
  - a correct blob opened under a wrong `vaultId` (any-of-N and Shamir), failing with `NO_MATCHING_KEY`;
  - a positive open per mode with the correct `vaultId`;
  - a cloned-blob candidate in selection.

**Out of scope:**
- Contract changes. The registry already takes a client-chosen `vaultId` and stays blob-agnostic.
- Web-app UI.
- The recovery tool's own code (it consumes the updated spec and vectors).

**Runtime dependencies:** none added. No CryoShield-operated backend.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `vault-crypto`: the AAD rules (wrap and payload), candidate selection, adding a key, updating the payload, and the test vectors now take the `vaultId` into account.

## Impact

- `packages/vault-crypto`: breaking API change. The frontend (`add-web-app`) and the recovery tool (`add-desktop-recovery-tool`) must pass the `vaultId` everywhere they open, update, or select.
- `docs/spec/vault-format-v1.md` and `test-vectors/v1.json`: amended and regenerated. All earlier vector blobs change.
- The registry (`add-vault-registry-contract`) is unchanged. A front-run `vaultId` collision now means re-encrypting under a fresh `vaultId` before retrying (see design.md).

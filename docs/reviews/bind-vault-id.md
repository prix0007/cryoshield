# Security review: bind-vault-id-to-ciphertext

| | |
|---|---|
| Change | `openspec/changes/bind-vault-id-to-ciphertext` (task 4.1) |
| Scope | `packages/vault-crypto` (src, tests, `test-vectors/v1.json`, `scripts/gen-vectors.py`), `docs/spec/vault-format-v1.md`, the change's artifacts |
| Reviewer | security-reviewer agent; contract cross-check by the overwatcher |
| Verdict | **APPROVE**: no CRITICAL, HIGH, or MEDIUM findings; 127 tests passing at review time |

## Checks performed

| Area | Result |
|---|---|
| **Clone attack (web-app review, HIGH)** | **Closed.** The 32-byte `vaultId` is in every wrap AAD and in the payload AAD. Both go through the shared `openCore` path, which `openVault`, `selectVault`, `addKey`, and `updatePayload` all use, in both modes (0x01 and 0x02). A byte-identical clone under another `vaultId` never authenticates, and `selectVault` skips it. |
| **Error oracle** | No new oracle. A wrong `vaultId` gives `NO_MATCHING_KEY`, which can't be told apart from a wrong key. |
| **Input validation** | `assertVaultId` requires exactly 32 bytes and non-zero, otherwise `INVALID_ARGUMENT` (checked before decoding when opening or adding; at creation, after the key-count checks). |
| **AAD encoding** | Unambiguous. The wrap AAD has fixed-width fields plus a length-prefixed rpId and credId, with the `vaultId` at a fixed 32-byte position after `wrapSalt`. The payload AAD is the self-delimiting blob prefix plus a fixed 32-byte `vaultId` suffix. |
| **Cross-implementation parity** | The Python generator (`gen-vectors.py`) and the TypeScript library agree byte for byte on all vectors, including the wrong-vaultId and cloned-candidate cases. |
| **Contract consistency** | Overwatcher verified the `VaultIdTaken`, `ZeroVaultId`, and `NotVaultOwner` errors in `contracts/src/VaultRegistry.sol:27-36`, matching the client-chosen, non-zero, unique `vaultId` assumed here. |

## Findings and fixes

| ID | Severity | Finding | Fix |
|---|---|---|---|
| L-1 | LOW | No vector or unit test for Shamir-mode `updatePayload` under a wrong `vaultId`. | Added vector `updatePayloadCases/update-shamir-wrong-vault-id` (`NO_MATCHING_KEY`) and a unit test. After regeneration, `v1.json` is byte-identical apart from the added case. No API change. |

## Residual risks (accepted)

- **vaultId front-running (griefing only).** A front-runner who copies a pending `vaultId` makes the victim's registration revert. The retry needs a new blob under a fresh `vaultId`, which means a full re-tap of every key, because the wrap AAD binds the `vaultId`. Accepted for the MVP. Post-MVP fix: the registry enforces `vaultId = keccak256(msg.sender, salt)`.
- **Arweave rollback.** An Arweave entry tagged with the genuine `vaultId` but holding an older genuine blob still authenticates. Detecting this depends on the on-chain event blob-hash checks (`VaultUpdated` carries `keccak256(blob)` and the version) or on the L1 anchor, not on this format.

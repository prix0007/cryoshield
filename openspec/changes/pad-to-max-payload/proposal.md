# Proposal: pad every vault payload to the maximum the 1 KB blob allows

> **Founder decision (2026-10-10, mainnet-gate review):** accept option O3 of
> `docs/compliance/on-chain-minimisation-options.md` before the first OP Mainnet vault. Every vault payload is padded to
> the largest size that fits the vault's key set under the 1024-byte cap, so the blob length reveals nothing about the
> secret's length. Only data that is already public (the key count, the credential-ID lengths, the RP ID and the mode)
> may influence the blob size.

## Why

Vault format v1 pads the payload to the next multiple of 64 bytes (spec §6.1). That hides the exact secret length but
not its size class. Review F3 (`docs/reviews/on-chain-confidentiality-2026-10.md`) measured it: with two 64-byte
credential IDs, a 12-word seed phrase gives a 526-byte blob and a 24-word phrase a 590-byte blob. Every blob, and every
earlier version of it, stays public forever on the chain and on Arweave. So an observer can often tell a 12-word from a
24-word phrase, or one item from several. This is the only thing the public record says about the secret itself.

The fix is cheapest now: no mainnet vault exists, and the decoders already accept longer zero padding.

## What Changes

- **Encoder rule (vault-crypto, normative):** the padded plaintext is always `64 × floor((1024 − overhead) / 64)`
  bytes, that is `maxPayloadBytes + 2`, where `overhead` depends only on the RP ID, the credential-ID lengths, N and the
  mode (spec §7). The blob length is then `overhead + 64 × floor((1024 − overhead) / 64)`, a function of public data
  only. The capacity rule (`maxPayloadBytes`) is unchanged.
- **Every write path re-pads to the new maximum:** create, update payload (edit, rename, archive, Archive and clear) and
  add-key. Add-key pads to the maximum for N + 1 keys, which is smaller, and refuses with `VAULT_TOO_LARGE` when the
  secret no longer fits (unchanged rule). There is no remove-key path in the format or the app.
- **Decoders unchanged:** the TypeScript library and the Python recovery tool already accept any `64k + 16`-byte
  payload ciphertext and check the length prefix and the zero padding after decryption. Existing testnet blobs, padded
  in 64-byte steps, keep decoding and opening. Decoders MUST NOT require maximum padding.
- **Format version stays 0x01.** The byte layout, AAD, nonces and decoder checks do not change; only what a conforming
  encoder writes does (design D2).
- **Test vectors:** `test-vectors/v1.json` is regenerated with the new rule and gains length-hiding groups (N = 2 and
  N = 3, mode 0x01 and 0x02, 12-word and 24-word seed phrases with identical blob lengths), add-key and update re-pad
  cases, re-pads of blobs with the old padding, a `legacyPaddingCases` section whose blobs are byte-identical to the
  previous file's, and two padding-check open cases. `docs/spec/payload-vectors.json` is regenerated (its blob vectors
  use the same encoder). Both implementations pass every case.
- **Spec:** `docs/spec/vault-format-v1.md` §6.1, §6.6, §6.7, §7 and §11 are amended in place, before any mainnet vault,
  following the precedent of the vaultId-binding amendment.
- **Web app:** no code change is needed at the call sites, because padding lives inside `createVault`, `updatePayload`
  and `addKey`. The integration gas test gains a 12-word / 24-word measurement; the cost docs are updated.
- **Gas and cost:** re-measured (forge snapshots for 526- and 974-byte blobs, the anvil full-stack test, and OP Mainnet
  fee readings) and recorded in `contracts/GAS.md` and `apps/web/docs/costs.md`.

### Out of scope

- Review F2 (payload-nonce derivation). It is not entangled with padding; its status and a caution about the review's
  suggested fix are recorded in design D6 for a separate decision.
- Filling the blob to exactly 1024 bytes (design D1 explains why the 64-byte granularity stays).
- Payload-layer changes: payload v2's `z` field and the "Archive and clear" sizing rule stay as they are
  (`docs/spec/payload-v2.md`).
- Contract changes. `contracts/src` is untouched; only gas tests, snapshots and `GAS.md` change.
- Re-writing existing testnet vaults. They are re-padded on their next write.
- Removing keys, rotating keys or any new write path.

### Runtime dependencies

None added. No CryoShield-operated backend. Calldata per write grows (design D7); the third-party bundler and paymaster
and Arweave see larger ciphertext only.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `vault-crypto`: "Length-hiding padding" pads to the maximum for the key set; "Adding a key" and "Updating the
  payload" re-pad to the maximum; "Deterministic test vectors" adds the length-hiding, re-pad and legacy-padding
  cases.
- `vault-recovery`: "Format v1 conformance" requires the tool to open blobs with either padding and to pass the new
  vector sections.

## Impact

- `packages/vault-crypto`: `src/padding.ts`, `src/vault.ts`, `src/format.ts`; tests; `scripts/gen-vectors.py`;
  `test-vectors/v1.json`; README.
- `docs/spec/vault-format-v1.md`, `docs/spec/payload-vectors.json`.
- `tools/recover`: the test-only writer (`tests/support/writer.py`), vector tests and pins. The shipped tool never
  writes vaults, and its decoder is unchanged.
- `apps/web`: `test-int/gas.int.test.ts`, `docs/costs.md`. No `src` change.
- `contracts`: `test/GasV2.t.sol`, `snapshots/VaultRegistryV2.json`, `script/gas-md.sh`, `GAS.md`.
- Existing testnet vaults: still readable; the next edit or add-key grows the blob to the maximum.

> **Archive after:** add-web-app, add-desktop-recovery-tool, harden-recovery-network-trust (this change MODIFIES requirements that those changes add to `vault-web-app` and `vault-recovery`, which are not yet in `openspec/specs/`). See task 0.2.

# Proposal: a "Your vaults" menu, encrypted vault names, and archive

## Why

A person with several vaults has no way to tell them apart or to set one aside.

- **Unlock gives no overview.** The unlock flow opens one vault per key tap. When a key's credential belongs to several vaults, or when older test vaults exist, the user sees a chooser of opaque candidates with no names, no dates and no counts.
- **Vaults have no names.** Nothing distinguishes "Family seed phrases" from "Work 2FA codes" until a vault is opened and its secrets are read.
- **There is no way to retire a vault.** The registry is append-only, so a vault can never be deleted. Users need an honest way to mark a vault as no longer in use, and, when they want it, to overwrite its current contents.
- **The recovery tool picks the first vault.** `tools/recover` prints the raw payload JSON, and `_select` takes the first vault that decrypts. A user with two vaults on the same key can't choose between them.

The planner also found two latent problems that this change must fix before it can add fields to the payload:

- **Edits would drop new fields.** `saveEdit` → `editVaultBlob` → `encodePayload(items)` rebuilds the payload from the items alone, so any new field would be lost on the next edit.
- **No staleness check before a write.** A session opened on one device can overwrite newer secrets saved from another device.

## What Changes

1. **Payload v2** (design D1–D3). A new, strictly canonical payload `{"v":2,"n":name?,"a":true?,"items":[...],"z":"000…"?}` carries an optional encrypted vault name (`n`), an archived flag (`a`), and size-preserving padding (`z`) used only by "Archive and clear".
   - The writer emits the **minimal version**: v1 whenever there is no name, no archive flag, no `z` and at least one item; otherwise v2 (D2, founder: yes).
   - Decoders accept v1 and v2. Decoding is strict and canonical in both TypeScript and Python (decode, validate, re-encode, byte-compare).
   - The format is published as `docs/spec/payload-v2.md` with shared vectors in `docs/spec/payload-vectors.json` (positive, negative and blob vectors), generated deterministically and pinned by SHA-256 in the recovery tool.
   - The vault blob format (`docs/spec/vault-format-v1.md`, `packages/vault-crypto/test-vectors/v1.json`) is **unchanged**: the payload is opaque to vault-crypto.
2. **"Your vaults" menu** (D5–D7, D9, D13). One lazy-loaded component, `VaultsMenu.tsx`, serves as both the unlock picker and the after-unlock menu.
   - Each row shows the name (or "Unnamed vault"), status as text, the item count, up to three labels, the key count, and the created and last-saved dates.
   - "Check another key" taps again and merges the result by vaultId; nothing about credentials is stored.
   - One owner (`Shell`) holds every decrypted vault, so auto-lock wipes the whole list.
3. **Vault name and archive** (D10, D11). The "Edit vault" sheet sets the name and the archived flag in one update. A no-op sends nothing; a name set at creation costs no extra write.
4. **Archive and clear** (D4, founder: include). Overwrites the vault with no items, keeps the name and the blob size, and requires an explicit confirmation whose copy says honestly that older versions stay readable.
5. **Writes start from the current blob** (D8). Every update re-reads the vault first and refuses with `STALE` if it changed since the session opened it.
6. **Credential labels** (D12, founder: yes). New credentials are labelled with the creation month only, e.g. "CryoShield vault · Oct 2026 (key 1)". The vault name is never put in a credential.
7. **Testnet save budget hint** (D10). On testnet, "About N free saves left" when N ≤ 10, computed from the account's EntryPoint nonce against the per-sender cap of 50.
8. **Recovery tool listing.** It parses payloads (v1, v2, raw fallback), groups candidates by vaultId, lets the user choose interactively, adds `--list`, and returns `AMBIGUOUS` (exit code 12) in a non-interactive run with several vaults and no `--vault-id`.

### Out of scope

- Deleting a vault, or making old versions unreadable. The registry is append-only and immutable, and earlier blobs stay in chain history and on Arweave. The copy says so.
- Any change to the vault blob format, `vault-crypto`, the test vectors in `packages/vault-crypto/test-vectors/v1.json`, or the recovery tool's blob-format pin.
- Any contract change. `VaultRegistry` v1 and v2 are used as deployed.
- Any change to gas sponsorship, the Pimlico policy or its limits. The save-budget hint only reads the public EntryPoint nonce.
- Storing credential IDs, vault IDs, names or any other vault data in browser storage to make "one tap shows everything" possible.
- Sorting or filtering by dates. Dates are display-only (D9).
- Renaming credentials that already exist on a key. Only new enrollments get the month label.
- Editing or archiving `VaultRegistry` v1 ("older test") vaults. They are listed read-only.

### Runtime dependencies

- **Added:** none. Dates come from `eth_getLogs` and block headers on the public chain RPC the app already uses. The save-budget hint is one `eth_call` to the EntryPoint on the same RPC.
- **Unchanged:** the public chain RPC, the third-party ERC-4337 bundler/paymaster (Pimlico) and Arweave.
- There is **no CryoShield-operated backend**.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `vault-web-app`:
  - MODIFIED: Vault payload encoding v1 (minimal-version writer rule; v2 is no longer "unknown"); Capacity feedback (reserve for the archive flag and the name); Create-vault flow (optional encrypted name, month-only credential label); Unlock and view flow (vault list, archived-only keys, auto-open rule); Secrets in memory only with auto-lock (covers the vault list).
  - ADDED: Vault payload encoding v2; Your vaults menu; Vault name and archive state; Archive and clear; Writes start from the current blob; Vault dates from public block data; Testnet save budget hint.
- `vault-recovery`:
  - MODIFIED: Candidate selection (group by vaultId, choose among vaults, `AMBIGUOUS` when non-interactive); Explicit confirmation before showing secrets (names, labels and status may be listed before confirmation; secret values never).
  - ADDED: Payload-aware display; Vault listing mode.

**No delta:** `vault-registry`, `vault-crypto`, `gas-sponsorship`. This change touches none of their requirements.

## Impact

- **apps/web:**
  - `src/vault/payload.ts` (v2 codec, strict canonical decoding), `src/vault/adapter.ts` (takes a `VaultPayload`), new `src/vault/summary.ts`;
  - `src/chain/unlock.ts` (`OpenedVault` gains name and archived), new `src/chain/history.ts` (lazy, with the menu);
  - `src/ui/operations.ts` (`saveEdit` preserves fields; new `saveVaultMeta`; archive and clear), `src/account/writes.ts` (`STALE`, `sponsoredOpsUsed`), and the EntryPoint `getNonce` ABI fragment beside the existing EntryPoint use in `src/account/`;
  - new lazy `src/ui/VaultsMenu.tsx`; `UnlockFlow.tsx`, `App.tsx`, `VaultView.tsx`, `CreateFlow.tsx`, `strings.ts`;
  - `src/webauthn/index.ts` (credential label), `scripts/verify-build.mjs` (lazy-chunk assertion);
  - `docs/payload-v1.md` points to the v2 spec; `docs/hardware-test.md` gains a two-YubiKey checklist.
- **tools/recover:** new `payload.py`; `recover.py` (`_open_all` grouped by vaultId), `ui.py` (`choose_vault`, structured display), `cli.py` (`--list`), README. Depends on the `harden-gas-sponsorship` recovery work (`feat/harden-gas-sponsorship-recover`, registry v1 + v2 reads) being merged first.
- **docs:** `docs/spec/payload-v2.md`, `docs/spec/payload-vectors.json`, `docs/system-design.md`, `docs/compliance/data-inventory.md`, and the security review `docs/reviews/vault-list-labels-archive.md`.
- **Release order:** the web writers (tasks 3.3, 3.4, 4.1) MUST NOT deploy before the v2 decoder (task 1.2) is live in production, so no live app ever meets a v2 payload it can't read.
- **Security:** see design.md → Threat model. Names, flags and counts stay inside the ciphertext; nothing new is public on-chain.

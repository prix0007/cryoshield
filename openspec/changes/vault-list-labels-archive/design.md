# Design: a "Your vaults" menu, encrypted vault names, and archive

## Context

- **Today:**
  - Each vault enrolls its own resident credential on every key, with a random `user.id` (`apps/web/src/webauthn/index.ts:149`). Its `user.name`/`displayName` is a generic label.
  - One WebAuthn `get()` returns **one** credential, so the web app learns **one** locator per tap. It decrypts the candidates under that locator and shows a chooser of opaque candidates when more than one decrypts (`Shell`'s separate `current`, `older` and `choices` state).
  - The payload is v1, `{"v":1,"items":[{"l":…,"s":…}]}`. The decoders reject extra fields (`apps/web/src/vault/payload.ts:48-49`, `apps/web/docs/payload-v1.md`) and any `v` other than 1.
  - `saveEdit` → `editVaultBlob` → `encodePayload(items)` rebuilds the payload from items alone.
  - Writes do not re-read the vault before an update.
  - The blob is padded to 64-byte buckets (`docs/spec/vault-format-v1.md`), so a smaller payload can visibly shrink the blob.
  - The recovery tool (CTAP2) sees **all** resident credentials for the RP in one tap. It prints the raw payload JSON, and `_select` takes the first vault that decrypts.
  - The web bundle has about 1.5 KB of headroom under its budget (`apps/web/scripts/verify-build.mjs:265`).
  - On testnet, Pimlico sponsors at most **50 operations per sender for its lifetime** (`harden-gas-sponsorship` D2).
- **Dependencies:**
  - `harden-gas-sponsorship` introduced VaultRegistry v2 and v1 + v2 reads. Vaults on VaultRegistry v1 are "older test vaults" here: they belong to retired accounts and are listed read-only. The recovery tool work in this change builds on `feat/harden-gas-sponsorship-recover`.
  - The requirements this change MODIFIES live only in the unarchived changes `add-web-app` (`vault-web-app`), `add-desktop-recovery-tool` and `harden-recovery-network-trust` (`vault-recovery`). Task 0.2 archives them first, or re-points the headers.
- **Founder answers (2026-10-06):** D2 yes (minimal-version writer), D4 include (archive and clear), D12 yes (month-only credential labels), D13 list (show the list for an archived-only key).
- **Hard constraints** (`openspec/config.yaml`): no CryoShield backend; CryoShield never sees plaintext; symmetric crypto only; recovery without CryoShield; users never handle gas.

## Goals / Non-Goals

**Goals:**
- A user can see every vault a key opens, tell them apart by an encrypted name and a summary, and open, rename or archive one.
- A vault is never hidden from its owner: archiving changes how it is grouped, never whether it is listed.
- No new public metadata: names, flags and counts stay inside the ciphertext.
- Old app versions and the recovery tool fail safe on new payloads (no silent field loss, no crash on display).
- One TypeScript and one Python codec that agree byte-for-byte, proved by shared vectors.

**Non-Goals:**
- Deleting a vault or making older versions unreadable (the registry is immutable and append-only).
- Showing every vault on every key after one tap in the web app (WebAuthn returns one credential per ceremony).
- Remembering credentials or vaults in the browser.
- Any change to the blob format, the contracts, or sponsorship.

## Decisions

### D1. Payload v2

```
{"v":2,"n":<name>,"a":true,"items":[{"l":<label>,"s":<secret>},...],"z":"000…"}
```

- **Key order is fixed:** `v`, `n`, `a`, `items`, `z`. Item objects keep v1's order, `l` then `s`.
- `n` is present only when the vault has a name. `a` is present only when the vault is archived, and its value is exactly `true`. `z` is present only after "Archive and clear" (D4), and is a non-empty string of ASCII `0`.
- `items` MAY be empty in v2 (v1 still requires at least one item). `z` MAY appear only when `items` is empty.
- v2 decoders also decode v1. Both produce one `VaultPayload { version, name?, archived, items, pad? }` type.
- **Older readers fail safe:**
  - an older web app shows "This vault was made by a newer version of CryoShield" and displays nothing, so it can neither show nor edit the vault, and so can never strip the new fields;
  - an older recovery tool prints the raw JSON after its confirmation step, which is still readable.
- **Published** as `docs/spec/payload-v2.md`, with `docs/spec/payload-vectors.json`. `apps/web/docs/payload-v1.md` gains a pointer to v2.

**Rejected alternatives:**
- *Add optional fields to v1.* v1 decoders reject extra fields, so every deployed app would show an error, and a relaxed decoder would let old apps drop the fields on edit.
- *Store names or flags outside the ciphertext* (registry field, Arweave tag, event). Public, permanent metadata; contradicts "no new public metadata"; needs a contract change.
- *Store names in browser storage.* Lost on another device and in the recovery tool, and the app's storage must stay empty of vault data.
- *A separate encrypted metadata blob.* Doubles the writes and the format surface for 40 characters.
- *CBOR or a binary encoding.* Breaks the "readable JSON" property of v1 and the raw-JSON fallback in older recovery tools.

### D2. Minimal-version writer (founder: yes)

The writer emits **v1** when there is no name, no archive flag, no `z`, and at least one item; otherwise **v2**.

- An unnamed, active vault keeps writing the same bytes as today, so older app versions keep working for users who never use the new features.
- The rule is deterministic, so the vectors fix it.

**Rejected alternatives:**
- *Always write v2 once the decoder ships.* Locks every vault out of every older app version at its next save, for no benefit to users who never name or archive.
- *A user setting for the version.* Exposes a format detail to non-technical users.

### D3. Strict canonical decoding (TypeScript and Python)

- **Scope: v2 only.** v1 payloads decode with the deployed v1 rules, unchanged (`payload.ts` `decodePayload` at `f2ce3da`: any key order, whitespace, any escape, last duplicate wins, one BOM stripped). A vault that opens today must never stop opening (overwatcher, 2026-10-08; reverses A7).
- **Decode, validate, re-encode, byte-compare (v2).** Any mismatch is `MALFORMED`. This rejects duplicate keys, whitespace, re-ordered keys, `"a":false`, `"a":1`, a `z` with any other character, a `z` next to items, and non-canonical escapes.
- **Python** checks `type(a) is bool` (because `1 == True`) and uses `json.dumps(..., ensure_ascii=False, separators=(",", ":"))`. It parses with `json.loads`' default last-wins handling of duplicate keys, like `JSON.parse`. A duplicate-rejecting `object_pairs_hook` would make v1 stricter than today; for v2, the byte comparison already rejects duplicates.
- **Escaping** follows `JSON.stringify`: `"`, `\` and C0 controls are escaped (`\b \f \n \r \t`, otherwise `\u00xx` lowercase); everything else is raw UTF-8. In v2, lone surrogates are rejected (strings MUST be well-formed Unicode); v1 keeps accepting them, as today.
- **Name rules:** 1–40 Unicode code points after decoding. Not allowed: C0 or C1 control characters (and DEL, A1); U+2028/U+2029; the bidi controls U+202A–U+202E and U+2066–U+2069; the invisible direction marks U+200E (LRM), U+200F (RLM) and U+061C (ALM); and the deprecated format controls U+206A–U+206F. The direction marks and format controls were added at review, before the vectors freeze. **Rationale:** they are invisible, and they can reorder or disguise how a name renders next to other text, so a vault could look like another, while a 40-character name has no use for them. ZWJ U+200D and ZWNJ U+200C stay allowed, because emoji sequences and several scripts need them. The same rules apply in the writer, so a name that fails them is refused in the form.
- **Nesting depth:** any JSON nesting deeper than 64 (open arrays and objects, counted outside strings, before parsing) is `MALFORMED` in both decoders, whatever `v` says. So Python's recursive parser and `JSON.parse` always agree. No valid payload is deeper than 3.
- Labels and secrets keep v1's rules.
- **Shared vectors** (`docs/spec/payload-vectors.json`): positive vectors (bytes ↔ structure), negative vectors (each must be `MALFORMED`), and blob vectors (a full encrypted blob per case, using the vault-crypto test keys). The file is generated by a deterministic script and regenerating it is byte-identical. The recovery tool pins its SHA-256.

**Rejected alternatives:**
- *Lenient decoding (accept any valid JSON with the right fields).* TypeScript and Python parsers differ on duplicate keys, numbers and booleans, so the two tools could show different names or flags for the same bytes.
- *A JSON canonicalisation library (RFC 8785).* A new dependency in both languages for a schema this small; re-encode-and-compare gives the same guarantee.

### D4. Archive and clear (founder: include)

- "Archive and clear" writes a v2 payload with `"a":true`, the same name, `"items":[]`, and a `z` sized so the payload byte length equals the previous payload's exactly. The blob therefore lands in the same 64-byte bucket and does not visibly shrink.
  - If the cleared payload without `z` is already at least as long as the previous one (only possible when the previous payload held a few bytes of secrets), it writes no `z`; the blob is never shorter than before.
  - A later save that adds items drops `z`. Unarchiving a cleared vault keeps `z`.
- **Confirmation:** an inline confirmation (no modal) with a required checkbox, "I understand old versions stay readable". The copy says plainly:
  - earlier versions stay in public chain history and on Arweave, forever;
  - anyone who holds one of this vault's keys **and** its PIN can still read those earlier versions;
  - to really retire a secret, change it at its source (move the funds, regenerate the recovery codes).
- The copy is reviewed in the security review (task 6.4).

**Rejected alternatives:**
- *Clear without padding.* The blob shrinks to the smallest bucket, which tells any observer that the vault was emptied.
- *Random padding bytes.* Inside the ciphertext they hide nothing more than `0`, and they complicate the canonical form.
- *No clear at all (archive only).* The founder chose to include it; with honest copy it helps a user who wants the current version to stop holding the secret.
- *"Delete vault".* Impossible on an append-only registry, and the word would mislead.

### D5. `VaultList`: one lazy component, two modes

`apps/web/src/ui/VaultsMenu.tsx`, loaded with `React.lazy` together with `src/chain/history.ts`.

- **Picker mode** (after an unlock tap that opens more than one vault): active vaults first; archived vaults behind "Show archived (N)"; VaultRegistry v1 vaults behind "Open an older test vault".
- **Menu mode** ("All vaults (N)" from an open vault): every section expanded, plus management actions (Open, Edit vault, Check another key).
- **Row content:** the name or "Unnamed vault"; status as text ("Active", "Archived", "Older test vault"), never colour alone; item count; up to 3 labels, each truncated to 24 characters, then "+N more"; the key count ("any 1 of 3 keys"); created and last-saved dates (D9).
- **Order:** active, archived, then older test vaults. Within a group, the order is the decrypt order (stable), never by date.
- Uses only the existing motionkit components; dates use `Intl.DateTimeFormat` with `dateStyle: 'medium'`.
- **Unlock auto-open:** when exactly one active VaultRegistry v2 vault decrypts, it opens directly; otherwise the picker is shown.

**Rejected alternatives:**
- *Two components (picker and menu).* Duplicated row rendering and two chunks over a tight budget.
- *Keep the menu in the main bundle.* About 1.5 KB of headroom (`verify-build.mjs:265`); the menu would exceed it.
- *A modal dialog.* The existing flows are full-screen steps; a modal adds focus-trap risk and code.

### D6. "Check another key"

- Runs one more WebAuthn `get()`; the user taps another key (or the same key's other credential, via the browser's chooser). The resulting vaults are merged into the list by vaultId; a vault already listed is not duplicated.
- No credential ID, vault ID or name is stored anywhere; the merged list lives only in memory (D7).

**Rejected alternatives:**
- *Remember credential IDs in localStorage* for an `allowCredentials` list. Breaks the "storage stays empty" requirement and links vaults on a shared computer.
- *A single shared credential for all vaults.* Every vault's PRF would come from one credential, the opposite of today's per-vault isolation, and changing it needs a format change.

### D7. One owner for decrypted vault state

- `Shell` holds `vaults: VaultSession[]`, replacing the separate `current`, `older` and `choices` states. Each `VaultSession` holds the opened payload, the blob it was decrypted from, and its metadata.
- Auto-lock runs while `session || vaults.length`. Lock, 5 minutes idle, `pagehide`, and 60 seconds hidden all wipe the whole list.
- This closes audit finding WEB-M2 for the chooser: today the candidate chooser can hold decrypted data outside the auto-lock's reach.

**Rejected alternatives:**
- *Each screen keeps its own state.* That is how WEB-M2 happened; one owner makes "wipe everything" one assignment.

### D8. Writes start from the current blob

- Before **any** update (edit, rename, archive, unarchive, archive and clear, add key), the writer re-reads `getVault(vaultId)`. If the blob differs from the one the session decrypted, it fails with `WriteError('STALE')`, nothing is signed, and the app says "This vault changed since you opened it. Unlock again."
- The check reads through the same RPC path as unlock. A lying RPC can at most make the check pass with a stale blob; the on-chain update then still only replaces the vault with what the user just saw plus their change, which is the pre-change behaviour.

**Rejected alternatives:**
- *Optimistic concurrency on-chain (expected version in `updateVault`).* Needs a contract change.
- *Merge the two versions.* Silent merges of secrets are dangerous and hard to explain.

### D9. Dates are display-only

- Paged `eth_getLogs` for `VaultCreated` and `VaultUpdated`, with topic1 = an OR of the listed vaultIds, from the registry's `deployBlock`, in bounded block ranges; then block timestamps for the blocks found.
- "Created" is the `VaultCreated` block's date. "Last saved" is shown **only if** the latest event's `blobHash == keccak256(current blob)` and its version matches the vault's; otherwise the row says "Date unavailable".
- Dates are never used for ordering, selection or freshness.
- Fetched lazily after the list renders, with a progress state; a failure leaves "Date unavailable".

**Rejected alternatives:**
- *Put dates in the payload.* The client clock is untrusted, and dates would grow every payload.
- *Sort by last saved.* An RPC controls those dates; ordering by them would let it reorder the list.

### D10. Gas

- The "Edit vault" sheet batches the name and the archive flag into **one** update. If nothing changed, Save sends nothing. A name entered during creation is part of the create write and costs nothing extra.
- **Testnet save budget hint:** `sponsoredOpsUsed` reads `EntryPoint.getNonce(owner, 0)`. When `50 − nonce ≤ 10` the app shows "About N free saves left". At 0, Save is disabled and the app shows the existing "Saving is paused" copy. The hint is "about" because failed operations may count differently (`harden-gas-sponsorship` task 1.1). It is shown only when the configured chain is a testnet; mainnet resets monthly and shows nothing.

**Rejected alternatives:**
- *Separate writes for rename and archive.* Doubles the use of a 50-operation lifetime budget.
- *Query Pimlico for the remaining budget.* No public per-sender endpoint, and the API key must not gain account APIs (`harden-gas-sponsorship` D3).

### D10 amendment. One EntryPoint nonce key (overwatcher, 2026-10-08)

Found at task 2.5: viem's `toSmartAccount` picks a fresh nonce **key** for every user operation (`Date.now()`), so `EntryPoint.getNonce(owner, 0)` stays 0 and the hint above could never count anything.

- **Decision:** the CryoShield wallet wrapper (`src/account/wallet.ts`) always uses nonce key **0**. `getNonce(owner, 0)` then counts every included operation of the account, and `sponsoredOpsUsed` reads exactly that. Client-side only: the EntryPoint and CryoShieldSmartWallet contracts are unchanged, and so is signing (UV, `rpIdHash`).
- **Under-count:** accounts that already saved under timestamp keys start counting from 0 at their next save. This only affects testnet accounts, and the hint already says "about".
- **Sequential operations:** one key means one sequence per account. Two tabs or devices saving at the same moment: the second operation reuses the same nonce and fails validation (EntryPoint `AA25 invalid account nonce`). The app maps it, from the paymaster, the gas estimate or the send, to `WriteError('NONCE_CONFLICT')` and a retryable message ("Another save for this vault was happening at the same moment … try again"), never "Saving is paused". When the first save has already landed, the D8 check (`STALE`) refuses the second one earlier, before any key tap.
- **Tests:** the nonce increments after a create and after each edit on the local stack; the AA25 mapping (unit and local stack); the write stack, `wallet.ts` included, stays out of the initial `/app` chunk (`verify-build`).

**Rejected alternatives:**
- *Count `UserOperationEvent` logs by sender.* Paged `eth_getLogs` over the EntryPoint's whole history on every open, through a public RPC.
- *Drop the hint.* Users would meet the 50-operation lifetime cap without warning.

### D11. Capacity

- The editor's "space remaining" reserves the bytes needed to archive the vault later (`"a":true,`, 9 bytes) and counts the name's encoded bytes (`"n":"…",`). v1 → v2 adds no bytes otherwise (`"v":2` is as long as `"v":1`).
- So a vault that is full still has room to be archived, and "Archive and clear" always fits (it only removes items).

**Rejected alternatives:**
- *No reserve.* A full vault could never be archived without deleting a secret first.

### D12. Credential labels (founder: yes)

- New credentials get `user.name` = `user.displayName` = "CryoShield vault · <Mon YYYY> (key <n>)", e.g. "CryoShield vault · Oct 2026 (key 1)". The month is an English short month name and the year, from the local clock, independent of locale.
- The vault name is **never** put in a credential: credential labels are stored unencrypted on the key, are shown by browsers and OS credential managers, and can't be changed after enrollment, while the vault name is meant to stay inside the ciphertext.

**Rejected alternatives:**
- *Use the vault name as the label.* Puts the name outside the ciphertext, on the key and in credential managers, and a later rename could never reach it.
- *Keep the generic label.* Users with several vaults can't tell credentials apart in the browser's chooser.
- *A full date.* More precise than needed to tell vaults apart.

### D13. Unlock when the tapped credential's only vault is archived (founder: list)

- The app shows the list with the archived section expanded, and the note "This key's vault is archived". It never says "We couldn't find a vault for this key" while an archived vault decrypted, and it never auto-opens an archived vault.

**Rejected alternatives:**
- *Auto-open the archived vault.* Ignores the user's choice to archive.
- *"Not found" with a hidden "show archived".* Makes the vault look lost; breaks the "never hidden from its owner" goal.

## Threat model

- **Who can write:** only the vault's smart account can call `updateVault`, and the account requires a WebAuthn signature with UV=1 and our `rpIdHash` (`harden-gas-sponsorship` D7). Archive, rename and clear are ordinary updates.

| Attacker | Can do | Cannot do |
|---|---|---|
| Stolen key **without** PIN | Nothing (credProtect level 3 and UV required) | Read, rename, archive or clear any vault |
| Stolen key **with** PIN | Already reads and edits the vault; archive, rename and clear are strictly weaker | Hide the vault from its owner: the menu lists every vault that decrypts regardless of the flag; the picker never says "not found" while an archived vault exists (D13); the recovery tool lists archived vaults. Make old versions unreadable (D4) |
| Co-owner key in a 1-of-N vault | Archive, rename or clear (any enrolled key can). The menu copy says so | Anything a single key couldn't already do |
| Locator stuffing, byte-identical clones | Add entries under the victim's locator | Get listed: entries that don't decrypt under their own vaultId are never shown. They only slow the list (progress state) |
| A stale v1 copy (from a lying RPC or Arweave) | Present an older, unnamed version | Override a newer v2 one: within a vaultId the existing freshness rules pick the copy, and the writer refuses stale bases (D8) |
| Lying RPC | Wrong or missing dates; pass the staleness check with a stale blob | Change ordering (D9); write anything (D8: the user still signs only what they saw) |
| Older app version | Shows "newer version" for v2 vaults | Edit them, and so strip names or flags (D1) |
| Observer of chain or Arweave | Sees blob sizes and update events, as today | Learn names, flags or counts (inside the ciphertext); learn that a vault was cleared (D4 keeps the size). The key count is already public in the blob header |

- **No leaks of labels or names:** names, labels and item counts are never written to the console, `errorReference`, analytics, `document.title`, the URL, or any browser storage. Tests assert this.
- **Recovery tool:** names and labels may be listed before the confirmation prompt; secret values never are. Names are made inert (control and bidi characters removed) before printing.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Edits drop the new fields | Task 2.1 regression test first; one `VaultPayload` type end to end |
| TypeScript and Python codecs diverge | D3 strict canonical decoding, shared positive and negative vectors, SHA-256 pin |
| Bundle budget exceeded | The menu and `history.ts` are one lazy chunk; `verify-build` asserts it |
| A stale session overwrites newer secrets | D8 `STALE` check before every write |
| Testnet per-sender cap (50 lifetime) | D10 batching, no-op guard, save-budget hint |
| False sense that "clear" erases | D4 copy and required confirmation, reviewed in 6.4 |
| Users expect one tap to show every vault | "Check another key", recovery `--list`, documentation |
| MODIFIED headers target unarchived changes | Task 0.2 archive order (proposal "Archive after") |
| A lying RPC fakes dates | D9 `blobHash` cross-check, dates display-only |
| Locator stuffing slows the menu | Progress state; only rows that decrypt render |
| Writers ship before the decoder is live | Release rule: tasks 3.3, 3.4 and 4.1 deploy only after 1.2 is live |

## Phasing (matches the tasks.md sections)

| Phase | Content | Gate |
|---|---|---|
| 0 | This plan; archive order | Merged; owning specs archived or headers re-pointed |
| 1 | Payload v2 spec, vectors, TS and Python codecs | Vectors frozen; both codecs green; decoder (1.2) released |
| 2 | Web data layer (no UI change) | Unit tests green |
| 3 | Web UI: menu, routing, name, auto-lock | E2E, axe and keyboard tests green; bundle check green |
| 4 | Archive and clear | Equal blob length test; copy test |
| 5 | Recovery tool listing (parallel with 2–4 after phase 1) | pytest and anvil e2e green |
| 6 | Docs, hardware checklist, security review | No open CRITICAL or HIGH |

## Assumptions recorded at task 1.1 [cry]

These points were left open by D1–D4. `docs/spec/payload-v2.md` and its vectors fix them. Each one can be reverted by an overwatcher decision before the vectors freeze (phase 1 gate).

- **A1. DEL in names.** "Control characters" in the D3 name rule means Unicode `Cc`, so U+007F (DEL) is refused along with C0 and C1. Vector: `n-del`.
- **A2. The version check follows the deployed rule.** After parsing (`JSON.parse` semantics), a `v` that is a JSON number other than 1 or 2 is `UNKNOWN_VERSION`, wherever it sits in the object. This includes `0`, `-1`, `2.5` and `3.0`. That is today's `decodePayload` rule, with 2 now known. (An earlier lexical-prefix rule was dropped with A7.) Vectors: `v-3*`, `v-10`, `v-zero`, `v-negative`, `v-fraction`.
- **A3. Non-minimal v2 decodes.** `{"v":2,"items":[…]}` with no `n`, `a` or `z` is valid: decoders keep `version`, and the re-encoding uses it. D2 binds writers only. Vector: `v2-non-minimal`.
- **A4. The Archive and clear gap (revised at review L1).** D4 covers `C0 >= P` (no `z`) and the exact case. When `C0 < P < C0 + 8`, an exact match is impossible, because `z` costs at least 8 bytes. The writer adds `z = "0"` only if `C0 + 8 <= 64*ceil((P+2)/64) - 2`, i.e. if the payload stays in the previous 64-byte block. Otherwise it writes no `z`, which provably also stays in that block. So the blob never shrinks and, in this case, never grows. Precondition: `maxPayloadBytes = 64k - 2`. Vectors: `clear-tiny-gap`, `clear-gap-block-boundary` (the earlier rule would have grown this blob by a block), `clear-gap-at-capacity`. The blob can grow only when `C0 > P` (re-clearing an unarchived cleared vault: `clear-recleared-*`).
- **A5. No trimming or normalisation.** Names are not trimmed and not NFC-normalised. Code points are counted as they are, so "Cafe" plus a combining accent is 5 code points. Vectors: `v2-name-spaces`, `v2-name-combining`.
- **A6. BOM: v1 as today, v2 malformed.** Like `TextDecoder`, decoders strip one leading BOM before parsing; Python must do this explicitly. A v1 payload with a BOM therefore opens, as it does today (`v1-legacy-bom`). v2 compares the re-encoding with the input bytes, so a BOM is `MALFORMED` (`utf8-bom`).
- **A7. REVERSED (overwatcher, 2026-10-08): v1 decoding is unchanged.** v1 payloads decode with the deployed v1 rules, lone surrogates included, and D3 applies to v2 only. The `v1-legacy-*` positive vectors pin this, among them the regression `v1-legacy-lone-surrogate-escaped` and its blob `blob-v1-legacy-lone-surrogate`. A web test runs every v1 positive and every negative vector against today's `decodePayload`. A v1 vault with a lone surrogate can still be saved as v1 (today's encoding). It can't be written as v2 (named, archived or cleared) until that secret is fixed, because v2 strings must be well-formed: the writer refuses, and nothing is lost.

## Assumptions recorded at tasks 3.1-3.4 [fe]

- **A8. Auto-open with other vaults present.** The spec's "Unlock and view flow" says both "exactly one active VaultRegistry v2 vault opens directly" and "more than one vault decrypts: show the list", which disagree when one active v2 vault decrypts next to an archived or an older test vault. The web app follows D5: exactly one **active v2** vault opens directly, and the others (archived, older test, or made by a newer version) are one tap away under "All vaults (N)". This keeps today's behaviour for keys that also open an older test vault. Anything else (two active vaults; only archived; only older test vaults) shows the picker; with no active vault every group is expanded, and D13's note is shown when an archived vault is among them.
- **A9. Vaults made by a newer version are listed.** A vault that decrypts but whose payload is `UNKNOWN_VERSION` or `MALFORMED` is listed ("Made by a newer version of CryoShield") with no Open or Edit action, so the list never hides a vault that decrypts. When it is the only vault, the unlock screen shows today's "newer version" message instead.
- **A10. Bundle shape.** The vault list chunk (VaultsMenu.tsx with chain/history.ts, the Edit vault sheet, and the name, archive and Archive and clear writes in ui/vault-meta.ts) must not import any module that reaches viem or the write stack: when a lazy chunk shares those with the write stack, the bundler splits the initial `/app` chunk and it grows by about 6 KB gzip. So `history.ts` gets the RPC and keccak-256 passed in, and `vault-meta.ts` gets the shared update path (`rewrite`) passed in. `verify-build` asserts the list is one lazy chunk and never in the initial graph.

## Web changes at the ECC review of feat/vlla-web [fe] (2026-10-08)

- **D8 + D10: writes are pinned to a nonce.** Every update reads the account's EntryPoint key-0 nonce first, then the vault (`assertCurrent`), and the user operation carries exactly that nonce (it is passed to `sendUserOperation`, so it is never re-read at send time). The nonce is also read when the vault opens and stored on the session; a later check that finds a different nonce is `STALE`, and each save of the session advances it by one.
  - **Guaranteed:** a write that this session's user confirms is based on the blob they saw. Any other operation of the same account that lands after the nonce read (another tab or device saving, including during a slow key tap) either changes the blob before the re-read (`STALE`, before any tap or signature) or consumes the pinned nonce, so the bundler or EntryPoint refuses this one (AA25, `NONCE_CONFLICT`, "a previous save may still be finishing; wait a minute, then try again"). Two tabs can no longer overwrite each other silently. Proven on the local stack (`test-int/writes.int.test.ts`, "two tabs").
  - **Not guaranteed:** a lying RPC can still return a stale blob and a stale nonce; the operation then fails at the bundler (the real nonce has moved) rather than overwriting, but the user sees a conflict, not "STALE". A stuck pending operation of the same account (sent but not yet included) is reported as a conflict until it lands or is dropped. Writes from VaultRegistry v1 accounts are out of scope (read-only).
  - The nonce at open is one raw `eth_call` to the EntryPoint from the initial chunk (`account/budget.ts`), so opening a vault still never fetches the write stack (harden-gas-sponsorship 5.5; `e2e/specs/20-security.spec.ts`). It also feeds the save-budget hint.
- **D9: the dates lookup.** Only public fields (`vaultId`, `version`, `blob`, `registry`) reach `history.ts`, never a decrypted session. The lookup is aborted when the list closes or locks, reads at most 200 pages per registry (a longer history or an absurd latest block gives "Date unavailable" without querying), accepts block timestamps only in 1 to 4e9, and runs only for vaults (or versions) it has not looked up yet, so "Check another key" adds one lookup. **Privacy:** one `eth_getLogs` query per page carries all listed vault IDs of a registry (topic1 OR). The IDs are public, but the RPC learns they were looked up together; one query per vault would multiply the requests by the number of vaults and is not used.
- **AA25 detection** looks only at the RPC's short text (`details`, `shortMessage`), case-sensitively (`\bAA25\b` or "invalid account nonce"), never at a full message that may carry calldata.
- **Display only, follow-ups for a spec revision (vectors unchanged):**
  - Runs of more than 3 combining marks in a name or a list label are shortened to 3 when shown; the stored name is untouched. Capping them in `validName` would make the web codec refuse names that the frozen spec and the Python codec accept.
  - Excluding U+200B, U+FEFF, U+00AD, U+E0000–U+E007F and U+FFF9–U+FFFB from names needs a spec and vector revision. Until then, a name made only of such characters shows as "Unnamed vault" (they are all `Cf`), and names render in a clipped `<bdi>`.

## Display-time requirements for later tasks (recorded at review of task 1.1)

The codec admits names and labels that are valid but can still mislead when shown. The tasks that display them MUST:

- **Web (tasks 2.2, 3.1, 3.3):** render every vault name and label in `<bdi>`, or in an element with `unicode-bidi: isolate`, so its text direction can't bleed into the surrounding UI.
- **Web (task 2.2):** truncate labels at 24 code points without ever splitting a surrogate pair (iterate code points, not UTF-16 units).
- **Web (tasks 2.2, 3.1, 3.3):** show "Unnamed vault" when a name has no visible glyph left (for example, only spaces or joiners).
- **Recovery tool (task 5.1):** strip characters of the categories Cc, Cf, Zl and Zp from names and labels before printing, and print with `errors="backslashreplace"`, because v1 labels and secrets can hold unpaired surrogates.
- **Web (task 1.2), review L1:** turn the `testIf`/`todo` fallbacks in `apps/web/test/vault/payload-v2.test.ts` into hard tests once the codec exists, so a missing export fails instead of being skipped.

## Recovery-tool decisions recorded at the ECC review of c9830c1 [rec]

- **R1. Arweave is always searched in locator mode.** Before, Arweave was a fallback when no chain copy opened. Now chain and Arweave candidates are merged before opening, so the list and the chooser show every vault the key opens. This is consistent with the "Arweave fallback" requirement, which says when Arweave MUST be queried, not that it must not be otherwise. Ranking still prefers a verified chain copy. If a source is unreachable or truncated, the tool warns that the list may be incomplete.
- **R2. No summary-only parse.** A parser that reads names and labels without building secret strings would be a second, hand-written JSON reader next to the vector-verified codec. The tool instead parses each decrypted `bytearray` in place, with no `bytes()` copy, and the README documents that listing an unchosen vault leaves unwipeable label and secret strings.
- **R3. Name display.** The status always comes first, in a fixed column. Names are shown last and quoted. A name counts as empty unless it has a character outside Cc, Cf, Zl, Zp, Zs, Mn, Me, Co, Cn, and not one of U+115F, U+1160, U+17B4, U+17B5, U+2800, U+3164 or U+FFA0. Runs of combining marks are capped at 3. ZWJ and ZWNJ are kept, because the codec allows them in names.
- **R4. `--vault-id` and `--blob-file` try every RP ID** (at most 3, safest first) and merge what each opens, instead of stopping at the first that opens.

## Open questions

None. The founder answered D2, D4, D12 and D13 on 2026-10-06.

## Security review

Recorded at task 6.4 in `docs/reviews/vault-list-labels-archive.md`.

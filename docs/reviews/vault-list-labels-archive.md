# Security review: `vault-list-labels-archive` (task 6.4)

- **Reviewer:** `security-reviewer` (read-only), final pass on merged `main` at `ec3cc62`, 2026-10-08.
- **Change:** `openspec/changes/vault-list-labels-archive` (proposal, design D1–D13, A1–A10, the review notes, the `vault-web-app` and `vault-recovery` deltas, tasks).
- **Audit finding touched:** WEB-M2 (`security-audit-2026-10.md`), for the vault chooser.

## Scope

| Area | Code on `main` | Merged in |
|---|---|---|
| Payload v2 spec and vectors | `docs/spec/payload-v2.md`, `docs/spec/payload-vectors.json`, `packages/vault-crypto/scripts/gen-payload-vectors.py`, CI vector check | PR #47 (`b2c4c81`) |
| Recovery tool | `tools/recover/src/cryoshield_recover/payload.py`, `recover.py`, `ui.py`, `text.py`, `cli.py` (`--list`, `AMBIGUOUS`) | PR #49 (`0aa5266`) |
| Web app | `apps/web/src/vault/payload.ts`, `payload-clear.ts`, `name.ts`, `summary.ts`, `adapter.ts`; `src/chain/history.ts`, `unlock.ts`; `src/account/writes.ts`, `budget.ts`, `wallet.ts` (nonce key 0); `src/ui/VaultsMenu.tsx`, `vault-meta.ts`, `operations.ts`, `App.tsx`, `UnlockFlow.tsx`, `VaultView.tsx`, `CreateFlow.tsx`, `strings-vaults.ts`; `src/webauthn/index.ts`; `scripts/verify-build.mjs` | PR #50 (`ec3cc62`) |

Out of scope: the hardware checklist (6.2), the release order (6.3, owner), and the docs task 6.1.

## Method

1. Read the whole change, the ECC reviews on PRs #47, #49 and #50, and the local-review summaries in the PR descriptions.
2. Re-checked every advisory against `main`. Each PR's final ECC review was at its merge head, so its advisories reached `main` unless a later PR fixed them.
3. Worked through the task 6.4 checklist on the source.
4. Looked for problems that only appear when the pieces run together: the vault list with v1/v2 authority, the nonce pin with the lazy write stack, archive-and-clear with the session base, and N registry versions with payload v2 in `--list`.
5. Ran:
   - `tools/recover` `pytest`: 858 passed, 5 skipped (opt-in). `ruff` and `mypy --strict` are clean.
   - `gen-payload-vectors.py --check`: byte-identical. The file's SHA-256 matches the recovery tool's pin.
   - Probes on scratch copies.
   - The web suites were **not** re-run here (no `node_modules` in the review worktree). PR #50's CI is the evidence for them: 1,103 unit, 19 integration and 73 E2E tests.

## Threat model summary

Design → Threat model holds on `main`.
- Names, flags and item counts exist only inside the ciphertext.
- Only the vault's account, signing with UV and our rpIdHash, can rename, archive or clear a vault. A stolen key without its PIN can do none of it. With the PIN, the attacker could already read and edit the vault, and archiving can't hide it from the owner.
- No one can forge a name or archived flag: a copy must authenticate under its own vault ID, so the only attack is replaying the user's own older genuine blob.
- An RPC can lie about dates (display only) or pass the STALE check with a stale blob and nonce. The operation then fails at the bundler; nothing is overwritten.
- Older apps refuse v2 payloads instead of stripping fields.

## Findings

Status: **Fixed** (in the PR and commit named) · **Accepted** (with the rationale) · **Open**.

### Fixed in the local reviews before push (summarised in the PR descriptions)

| # | Sev | Finding | Fixed in |
|---|---|---|---|
| L1 | MED | Two tabs or devices could silently overwrite each other during a slow tap. Now **nonce-pinned STALE closure:** the key-0 nonce is read first, then the blob (`assertCurrent`, `writes.ts:207-221`), the operation carries that nonce (`:146`), and the session nonce advances per save (`operations.ts:74,229`). Nonce key 0 is forced (`wallet.ts:66`) | PR #50 (`b3e4303`); `test-int/writes.int.test.ts` "two tabs" |
| L2 | MED | The dates lookup took decrypted sessions, and was unbounded and unabortable. Now only public fields, abort on close or lock, a 200-page cap, and timestamps limited to 1–4e9 | PR #50 (`b3e4303`) |
| L3 | MED | AA25 matched loosely. Now only `details`/`shortMessage`, case-sensitive (`writes.ts:168-178`) | PR #50 (`b3e4303`) |
| L4 | MED | Display spoofing. Names and labels now render in `<bdi>` with CSS isolation; labels are truncated by code point; combining marks are capped at 3; invisible-only names show "Unnamed vault" (`vault/name.ts`, `summary.ts:28-31`, `global.css:687-700`) | PR #50 (`b3e4303`) |
| L5 | MED | Recovery tool: the list missed Arweave copies; a name could pose as a status; decrypted buffers were copied | PR #49 (`ea9c093`): chain and Arweave are always merged, status first with the name quoted last, in-place decode with a wipe on `BaseException` |
| L6 | MED | v1 decoding would have changed (A7) | PR #47 (`93a2fc2`): v1 decoding as deployed, pinned by `v1-legacy-*` vectors |
| L7 | MED | Name rules missed direction marks and format controls; no depth limit; the gap rule could grow a blob | PR #47 (`68f2444`) |

### PR #47: spec and vectors

| # | Sev | Finding | Status |
|---|---|---|---|
| S1 | MED | Invisible look-alike `Cf` characters (U+200B, U+FEFF, tags, U+FFF9–FFFB) are allowed in names | **Open, recorded follow-up** (design, "Web changes at the ECC review"; needs a vector revision). Mitigated at display: the web shows "Unnamed vault" when nothing is visible, and the recovery tool strips `Cf` |
| S2 | MED | The spec delta omits DEL and the 64-level depth limit | Open (spec text only; both codecs enforce them, `payload.py:63-71,123-143`, vectors `n-del` and depth) |
| S3 | MED | v2 web tests could stay `todo`; vector sections could be empty | Fixed: direct imports, and every section must be non-empty (`payload-v2.test.ts:135`) |
| S4 | LOW | Python and JS disagreed on a `v` of more than 4,300 digits | Fixed (`parse_int=float`, `payload.py:200-206`) |
| S5 | LOW | `forbiddenNameRanges` in the vectors misses U+061C, U+200E–F and U+206A–F; some fields are unasserted; no `--only-binary`, and no explicit `--check` step in CI | Open (LOW; no code reads `forbiddenNameRanges`) |

### PR #49: recovery tool

| # | Sev | Finding | Status |
|---|---|---|---|
| RT1 | MED | The `--vault-id`/`--blob-file` merge across RP IDs keeps the first group that opens, not the best-ranked one (`recover.py:587-593`) | Open (pre-existing behaviour; the older copy still gets `_settle` and its warnings on the chain path) |
| RT2 | MED | A locked (Shamir) best copy is replaced by an older copy that opens with one key (`recover.py:346-361`) | Open (pre-existing behaviour) |
| RT3 | MED | Arweave is always queried, but no spec delta modifies "Arweave fallback" | Open (spec text; decision recorded as design R1) |
| RT4 | MED | Dataclass `__repr__` of `Item`/`VaultPayload` includes the secret (`payload.py:39-51`) | Open, latent. No path prints a repr: the last-resort handler prints only the exception type (`cli.py:475`). Fix with `field(repr=False)` |
| RT5 | MED | A newline in a secret can print fake `END SECRETS` or `label:` lines (`ui.py:120-142`) | Open. Only someone who can write the vault (key and PIN) can author it; labels are safe because `\n` is stripped |
| RT6 | MED | Exit 12 prints ID and freshness; the spec says "IDs and statuses" | Open (wording); no plaintext either way |
| RT7 | LOW | `inert_label` lets ZWJ reset the combining-mark cap; backslashes are doubled on screen; chooser `int()` on more than 4,300 digits; a wipe window in `_conclude`; the incomplete warning is missing on single-vault runs; unquoted labels in `describe()`; `sanitize()` keeps joiners | Open (LOW) |

### PR #50: web app

| # | Sev | Finding | Status |
|---|---|---|---|
| WB1 | MED | The dates cap (200 × 10,000 blocks) covers about 46 days, so from late November 2026 every row shows "Date unavailable" (`history.ts:21-23,75`) | Open. Display only, fails safe |
| WB2 | MED | **Release order:** the writers were merged in the same commit as the v2 decoder | Open, owner task 6.3. No production release may carry the writers until a release with the decoder is live |
| WB3 | MED | An operation that is included but reverts, or comes back NOT_CONFIRMED, uses up the pinned nonce, so retries get a false STALE (`VaultView.tsx:144-147`) | Open. Fails closed: unlocking again recovers |
| WB4 | MED | Unarchive ignores `budget.blocked` (`VaultView.tsx:226`) | Open. The user taps, then sees "Saving is paused"; no harm |
| WB5 | MED | Clear confirmation: focus isn't moved; `understood` isn't reset after a failed write; `onClear` drops unsaved name or archive edits | Partly fixed (reset on Cancel, `VaultsMenu.tsx:296`); the rest is open |
| WB6 | MED | Unlock re-entry: "Try again" and "Create instead" are not disabled during a ceremony (`UnlockFlow.tsx:99-101`) | Open (UX; the epoch guards still drop late results after lock) |
| WB7 | MED | The dates cache is lost when the list unmounts, and an abort race clears a newer fetch's marker (`VaultsMenu.tsx:106,135`) | Open (extra public RPC queries; display only) |
| WB8 | LOW | Stale `draft` after Archive and clear keeps cleared plaintext in React state until unmount (`VaultView.tsx:64,283`) | Open. It is wiped by lock and auto-lock with the rest of the session |
| WB9 | LOW | A v1 vault with `payloadError` is listed twice; Lock is disabled during "Check another key"; `BigInt` runs before the length check in `history.ts`; `ts()` ignores the abort signal; `aria-live` on every row; no `role="alert"` on the name error; `pinNonce` compares ids case-sensitively; `VAULTS.nothingNew` is unused | Open (LOW) |
| WB10 | LOW | The "Created" date is not cross-checked | Accepted: display only, and dates never order, select or decide freshness (D9) |
| WB11 | LOW | A write in flight after lock could restore a session | Accepted: after lock, `onChange` maps over an empty list (`App.tsx:218`) |

### New in this final pass

| # | Sev | Finding | Status |
|---|---|---|---|
| N1 | MED | **WEB-M2, the "saved" screen, is still open.** After a successful create, `CreateFlow` keeps the plaintext `items` and the decrypted `session` in its own state. Its `useAutoLock` is off in the `done` step (`CreateFlow.tsx:51`), and Shell's auto-lock is off because `vaults` is empty until Continue (`CreateFlow.tsx:243`). So the decrypted vault stays in memory with no idle lock, `pagehide` wipe or hidden timer until the user presses Continue | **Open.** Fix: keep the auto-lock active in `done` and wipe `items` and `session`, or hand the session to Shell at once. The chooser half of WEB-M2 is closed (D7) |
| N2 | LOW | False STALE on the first edit right after a create, if a lagging load-balanced RPC returns the pre-create nonce at mount | Open. Fails closed; related to WB3 |
| N3 | LOW | `--list` summarises the best copy that opens without `_settle`, and doesn't say when that copy came from a supplied (untrusted) registry. A replayed older copy can show an earlier name or active/archived state | Open. Mitigated: the row says "unverified (may be outdated)" when the copy is not CURRENT or VERIFIED, or is contested. The chooser re-derives the summary from the copy actually opened |

**Combined-behaviour checks that passed:**
- **v1/v2 authority in the list.** Rows are keyed `registry:vaultId`, and a v1 row exists only when v2 lacks the id at read time. So a stale v1 copy of a v2 vault can't appear as a separate openable row, including across "Check another key".
- **Add-key from a list entry** uses that session's nonce pin and `s.owner`, the account that signs. The budget hint reads the same address.
- **Archive and clear** sizes `z` from the blob `assertCurrent` has just verified as current.
- **The lazy chunks** (the write stack and `VaultsMenu`) are same-origin under `script-src 'self'` and Trusted Types (`vite-plugins/csp.ts`). `verify-build.mjs:291-310` keeps both out of the initial `/app` graph, and opening a vault never fetches the write stack (`budget.ts` is a raw `eth_call`).
- **No signature or PRF tap comes before the STALE check** on any update path. Create has no base and checks `vaultIdFor` instead.

### Task 6.4 checklist

- **The codecs agree:** pass. Both pass every shared vector, the Python bool check is `type(a) is bool` (`payload.py:166`), the SHA-256 pin matches, and the generator is deterministic.
- **No edit path drops `n` or `a`:** pass. One `VaultPayload` type runs end to end (`payload.ts:140-145`, `operations.ts:197`).
- **STALE before every signature:** pass for edit, rename, archive, unarchive, Archive and clear, and add-key. Each is checked again right before signing (`writes.ts:315,332`).
- **The list never hides a vault that decrypts and never lists one that doesn't:** pass. Archived and newer-version vaults are listed (A9, D13); junk and clones never authenticate. WB9's duplicate row is cosmetic.
- **Auto-lock wipes every listed vault:** pass for the list (`App.tsx:45,76-85`). The create "saved" step is N1.
- **Names and labels never leak:** pass. They never reach the console, `errorReference`, analytics (landing page only), `document.title`, the URL or storage. Credential labels are month-only (`webauthn/index.ts:89-91`).
- **Archive and clear keeps the length, and its copy is honest:** pass. The copy names chain history, Arweave, "any of this vault's keys and its PIN", and changing the secret at its source (`strings-vaults.ts:55-60`).
- **Dates are display-only and cross-checked:** pass. "Last saved" is shown only when the `blobHash` and version match. WB1 limits the feature, not its safety.
- **The recovery tool shows no secret before confirmation and makes names inert:** pass. `Cc`, `Cf`, `Zl` and `Zp` are stripped, and output uses `backslashreplace`. RT5 is a frame-forgery residual that only the vault's own writer can trigger.
- **No new runtime dependency and no CryoShield server:** confirmed.

## Residual risks

- **The create "saved" screen** holds the decrypted vault with no auto-lock until Continue (N1, WEB-M2 remainder).
- **Older versions stay readable forever** to anyone holding a key and its PIN. "Archive and clear" only changes the current version, and the copy says so.
- **Release order (WB2).** A production release that carries the writers before the decoder is live would show "newer version" for renamed, archived or cleared vaults in the older app. The owner holds production releases until task 6.3.
- **Look-alike names** made with invisible `Cf` characters (S1) until the vector revision.
- **Pre-existing recovery-tool ranking quirks** (RT1, RT2) and the `--list` staleness caveat (N3).
- **A user without a key can't be shown everything:** one WebAuthn ceremony returns one credential, and nothing is stored to remember the rest. "Check another key" and the recovery tool's `--list` cover this.

## Open owner, hardware and docs tasks (not part of this review)

- vlla 0.2: archive order for the owning specs.
- vlla 6.1: `docs/system-design.md` (partly done) and `docs/compliance/data-inventory.md`, which doesn't yet list vault names or the month-only credential labels.
- vlla 6.2: the two-YubiKey checklist on OP Sepolia.
- vlla 6.3: release the decoder to production, and confirm it is live, before any release that carries the writers.

## Verdict

**APPROVE (task 6.4). No open CRITICAL or HIGH.** No HIGH was raised in any review round of this change. The claimed MEDIUM fixes are in the code on `main`. What is open is MEDIUM or below: availability and UX, display-only dates, latent leaks with no path to the screen, spec wording, and the WEB-M2 "saved" screen (N1).

**N1 and WB2 should be closed before the writers ship to production.**

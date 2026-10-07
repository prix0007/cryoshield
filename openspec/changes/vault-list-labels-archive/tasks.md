# Tasks

> **Archive after:** add-web-app, add-desktop-recovery-tool, harden-recovery-network-trust.

**Owners:**
- **[fe]** frontend-engineer
- **[rec]** recovery-engineer
- **[cry]** crypto-engineer (payload spec and vectors only; vault-crypto itself is unchanged)
- **[ow]** overwatcher or founder
- **[sec]** security-reviewer

**TDD:** write each listed test first, see it fail, then implement. Sections match design.md → Phasing.

**Release rule:** the web writers (tasks 3.3, 3.4 and 4.1) MUST NOT be deployed to production before the v2 decoder (task 1.2) is live in production. Ship 1.2 in its own release first; the writers go out in a later release.

## 0. Plan

- [x] 0.1 [ow] Write this change (proposal, design with D1–D13, the threat model and the risk table, spec deltas, tasks). Verify: `openspec validate vault-list-labels-archive --strict` and `openspec validate --all --strict`.
- [ ] 0.2 [ow] Archive order and dependencies, before any implementation PR merges:
  - the `harden-gas-sponsorship` recovery work (`feat/harden-gas-sponsorship-recover`, registry v1 + v2 reads) is merged;
  - `add-web-app`, `add-desktop-recovery-tool` and `harden-recovery-network-trust` are archived, so `vault-web-app` and `vault-recovery` exist in `openspec/specs/`; or, if any of them can't be archived first, the MODIFIED headers here are re-pointed (moved to ADDED with new names) so archiving this change can't fail.

  Verify: `openspec/specs/vault-web-app/spec.md` and `openspec/specs/vault-recovery/spec.md` contain every requirement header this change MODIFIES, word for word, and `openspec validate --all --strict` passes.

## 1. Payload v2 codec and vectors [cry] [fe] [rec]

- [x] 1.1 [cry] Freeze the format first. Write `docs/spec/payload-v2.md` (design D1–D3: key order, field rules, name rules, escaping, minimal-version writer, `z` rules, strict canonical decoding) and a deterministic generator that writes `docs/spec/payload-vectors.json`:
  - positive vectors (v1 and v2 bytes ↔ structure, including the D2 minimal-version cases and a cleared vault with `z`);
  - negative vectors (duplicate keys, whitespace, reordered keys, `"a":false`, `"a":1`, `z` with items, `z` with a non-`0` character, a 41-code-point name, names with C0, C1, U+2028 and U+202E, a lone surrogate, non-canonical escapes, an empty v1 `items`, `"v":3`);
  - blob vectors (each encrypted with the vault-crypto test keys and vault IDs).

  Point `apps/web/docs/payload-v1.md` at the v2 spec. Verify: running the generator twice gives a byte-identical file (a CI check), and `packages/vault-crypto/test-vectors/v1.json` and `docs/spec/vault-format-v1.md` are unchanged.
- [x] 1.2 [fe] Write failing tests in `apps/web/test/vault/payload.test.ts` that run every vector, then implement the v2 codec in `apps/web/src/vault/payload.ts`: a single `VaultPayload` type, v1 + v2 decoding, strict canonical decoding (decode, validate, re-encode, byte-compare), and the minimal-version writer. Verify: `pnpm --filter web test`. **This is the decoder release** (see the release rule).
- [x] 1.3 [rec] In parallel with 1.2: write failing tests in `tools/recover/tests/test_payload.py` that run every vector and check the file's SHA-256 pin, then implement `tools/recover/src/cryoshield_recover/payload.py` (v1 with the deployed lenient rules, last duplicate wins as in `JSON.parse`, one leading BOM stripped; v2 strict: `type(a) is bool`, `ensure_ascii=False` with compact separators, well-formed Unicode, byte compare; see `docs/spec/payload-v2.md` section 7). Verify: `pytest`.

## 2. Web data layer (no UI change) [fe]

- [x] 2.1 [fe] Write a failing regression test first: saving an edit of a named, archived vault keeps `n` and `"a":true` (design risk "edits drop fields"). Then change `src/vault/adapter.ts` and `src/ui/operations.ts` so `saveEdit` → `editVaultBlob` take a whole `VaultPayload`, never items alone. Verify: unit tests.
- [x] 2.2 [fe] Write failing tests, then extend `OpenedVault` in `src/chain/unlock.ts` with `name` and `archived`, and add `src/vault/summary.ts` (row summary: name or "Unnamed vault", status, item count, first 3 labels truncated to 24 characters plus "+N more", key count). Verify: unit tests, including a 24-character truncation and a label with combining characters.
- [x] 2.3 [fe] Write failing tests with a mocked RPC, then add `src/chain/history.ts` (design D9): paged `eth_getLogs` with an OR of vault IDs in topic1, bounded block ranges from `deployBlock`, block timestamps, and the `blobHash` + version cross-check that yields "Date unavailable". Cover a refused query, a mismatching hash and a page boundary. Verify: unit tests.
- [x] 2.4 [fe] Write failing tests, then add `saveVaultMeta` in `src/ui/operations.ts` (name and archived flag in one update; a no-op sends nothing; D11 capacity reserve). Verify: unit tests, including "no-op sends no user operation" and "a full vault can still be archived".
- [x] 2.5 [fe] Write failing tests, then in `src/account/writes.ts`: re-read `getVault` before every update and throw `WriteError('STALE')` before signing when the blob differs (D8); add `sponsoredOpsUsed` from `EntryPoint.getNonce(owner, 0)` with the ABI fragment beside the existing EntryPoint use in `src/account/`. Verify: unit tests, including "STALE requests no signature" for edit, rename, archive and add-key, and `test:int` against the local stack.

## 3. Web UI [fe]

- [ ] 3.1 [fe] Write failing component tests, then add the lazy `src/ui/VaultsMenu.tsx` (`React.lazy`, with `history.ts` in the same chunk), in picker and menu modes (design D5), using only the existing motionkit components, inline confirmation, and `Intl.DateTimeFormat` medium dates. Add a `scripts/verify-build.mjs` assertion that the menu is a separate chunk not loaded by the entry, and that the main bundle stays within budget. Verify: unit tests and `pnpm --filter web build`.
- [ ] 3.2 [fe] Write failing tests, then route `UnlockFlow.tsx` (design D5 auto-open rule, D13 archived-only note, "Check another key" merge by vault ID, D6) and `App.tsx` (the `vaults` screen, `Shell`'s single `vaults: VaultSession[]` state replacing `current`/`older`/`choices`, auto-lock while `session || vaults.length` with the 60-second hidden rule, Suspense fallback). Verify: unit tests, including "auto-lock wipes every listed vault" and "storage stays empty".
- [ ] 3.3 [fe] Write failing tests, then update `VaultView.tsx` (name heading, Archived notice with Unarchive, "All vaults (N)", the Edit vault sheet, the save-budget hint on testnet) and `strings.ts` (all new copy, including the 1-of-N "any key can rename or archive" note). Verify: unit tests and the jargon scan. *Writer: release rule applies.*
- [ ] 3.4 [fe] Write failing tests, then add the optional name field to `CreateFlow.tsx` (name rules from D3) and the month-only credential label in `src/webauthn/index.ts` (D12). Verify: unit tests asserting the label format and that the label never contains the name. *Writer: release rule applies.*
- [ ] 3.5 [fe] Add E2E coverage: axe on every new screen, keyboard-only navigation of the list and the Edit vault sheet, and a scan proving names and labels never reach the console, `document.title`, the URL, analytics or storage. Verify: `test:e2e`.

## 4. Archive and clear [fe]

- [ ] 4.1 [fe] Write failing tests first: the cleared blob has the same length as the previous blob (and is never shorter in the tiny-payload case), the name is kept, a later save with items drops `z`, and the button stays disabled until the confirmation box is checked. Then implement in `src/ui/operations.ts`, `VaultsMenu.tsx` and `strings.ts` (design D4). Add a copy test that the confirmation text mentions chain history, Arweave, "any of this vault's keys and its PIN", and changing the secret at its source. Verify: unit tests and `test:e2e`. *Writer: release rule applies.*

## 5. Recovery tool listing [rec] (parallel with 2–4, after 1.3)

- [x] 5.1 [rec] Write failing tests, then change `recover.py` (`_open_all` groups authenticating candidates by vault ID and ranks freshness within each, under the existing quorum and tie rules) and `ui.py` (`choose_vault`; structured display with name, status and `label: secret`; inert names and labels; raw fallback). Non-interactive without `--vault-id` and with several vaults exits 12 (`AMBIGUOUS`) printing only IDs and status. Verify: `pytest`, including the zeroization tests for decoded payloads.
- [x] 5.2 [rec] Write failing tests, then add `--list` to `cli.py` (IDs, names, status, counts and freshness; no labels or secret values; archived vaults included). Update the README. Verify: `pytest`.
- [x] 5.3 [rec] Extend the anvil e2e: two vaults on one key (one named and archived, one v1), recovered interactively, with `--list`, and non-interactively (exit 12). Verify: the e2e job passes.

## 6. Docs, hardware check and security review [fe] [ow] [sec]

- [ ] 6.1 [fe] Update `docs/system-design.md` (payload v2, the vault list, staleness check, dates) and `docs/compliance/data-inventory.md` (vault names: client-side only, inside the ciphertext; month-only credential labels). Verify: docs review in 6.4.
- [ ] 6.2 [fe] Add a two-YubiKey checklist to `apps/web/docs/hardware-test.md`: create a named vault, create a second vault, unlock and see the list, Check another key, rename + archive in one save, archive and clear, STALE from a second browser, recovery `--list` and choose. Verify: the checklist is run on OP Sepolia and recorded.
- [ ] 6.3 [ow] Release the decoder (1.2) to production and confirm it is live before releasing any writer task. Verify: the release notes name the decoder release and the later writer release.
- [ ] 6.4 [sec] Security review of sections 1–5. Check:
  - the strict canonical codecs agree (vectors, negative cases, the Python bool check, the SHA-256 pin);
  - no edit path can drop `n` or `a`;
  - the STALE check runs before every signature;
  - the vault list never hides a vault that decrypts, and never lists one that doesn't;
  - auto-lock wipes every listed vault (WEB-M2 for the chooser);
  - names and labels never reach logs, error references, analytics, the title, the URL or storage, and never a credential label;
  - "Archive and clear" keeps the blob length and its copy is honest;
  - dates are display-only and cross-checked;
  - the recovery tool shows no secret value before confirmation, and makes names and labels inert;
  - no new runtime dependency and no CryoShield server.

  Record it in `docs/reviews/vault-list-labels-archive.md`. Verify: no open CRITICAL or HIGH findings.

# Tasks

> Owners: **[fe]** frontend engineer, **[sec]** security reviewer. **TDD:** each test first, then the code.

## 1. Fixes [fe]

- [x] 1.1 N1/WEB-M2: test first (`test/ui/create-autolock.test.tsx`: pagehide, 5 min idle, 60 s hidden on the saved screen; Continue still opens). Then `onSaved` hands the session to the Shell and the flow drops its plaintext (D1). Verify: vitest.
- [x] 1.2 WB1: tests first (`test/chain/history.test.ts`: backward walk, events 5M blocks before latest, refused-range halving, refusal at the base size, the 200-query cap, logs outside the window). Then the backward walk (D2). Verify: vitest.
- [x] 1.3 WB3/N2: tests first (`test/account/writes.test.ts` lag re-reads and a nonce above the pin; `test/ui/stale-repin.test.tsx`: re-pin after a failed save, no pin at open while the RPC shows another blob, never lowered after a success, Reload vault, a reload with the wrong key). Then D3. Verify: vitest.
- [x] 1.4 WB4: test first (`test/ui/vaults-menu.test.tsx`): Unarchive blocked at 0 saves, enabled with saves left. Then D4. Verify: vitest.
- [x] 1.5 W1: tests first (`test/chain/registry.test.ts`: empty, short and long pages, the oldest registry; `vaults-menu.test.tsx`: the message). Then D5. Verify: vitest.
- [x] 1.6 Wording: test first (`test/ui/vaults-v3.test.tsx`). Then D6 and the tests that quote the copy. Verify: vitest.
- [x] 1.7 Docs: `docs/compliance/data-inventory.md` (names, archived flag, month-only labels; ciphertext only) and `docs/system-design.md`; tick vlla 6.1. Verify: review.

## 2. Checks [fe]

- [x] 2.1 Unit, integration, E2E, typecheck, lint, `verify-build` (e2e and production, within the baseline) and `openspec validate --all --strict`. Verify: all pass.

## 2b. ECC security review of 86fbc66 [fe]

- [x] 2b.1 M1: tests first (`test/ui/stale-repin.test.tsx`: NOT_CONFIRMED and NETWORK with a landed save behind a lagging read keep the pin, so the next save is STALE; REVERTED with a nonce moved by more than one is not adopted). Then re-pin after a failure only for REVERTED/NONCE_CONFLICT at exactly pinned + 1 (D3). Verify: vitest.
- [x] 2b.2 L1: test first: a reload returning an older version is refused ("try again"). L3: test first: a short page is read once more. Verify: vitest.

## 3. Security review [sec]

- [x] 3.1 Review D1 and D3 against the threat model (the pin is only raised on the session's own blob; Reload replaces the session only for the same `registry:vaultId`). Done as the local ECC security review of 86fbc66 (M1 fixed in 2b.1, L1 and L3 in 2b.2). Verify: no open CRITICAL or HIGH.

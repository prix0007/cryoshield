# Proposal: Web follow-ups from the final security reviews

## Why

The final security-review records on `main` (`docs/reviews/vault-list-labels-archive.md`,
`docs/reviews/harden-gas-sponsorship.md`) leave open web findings. Two of them should be closed before the vault-list
writers ship to production (N1/WEB-M2), and the rest affect availability or honesty of the UI:

- **N1 (WEB-M2 remainder, MEDIUM):** after a create, the "saved" screen holds the decrypted vault with no idle lock,
  `pagehide` wipe or hidden timer until Continue.
- **WB1 (MEDIUM):** dates stop after about 46 days of chain history (200 pages × 10,000 blocks).
- **WB3 / N2 (MEDIUM / LOW):** a retry after a failed save, or a first edit behind a lagging RPC, gets a false
  "changed since you opened it" (STALE), and STALE is a dead end.
- **WB4 (MEDIUM):** Unarchive ignores the zero-saves-left gate.
- **W1 (MEDIUM):** an empty or short `resolveLocator` page silently shortens the vault list.
- **vlla 6.1 (docs):** the data inventory doesn't list encrypted vault names, the archived flag or the month-only
  credential labels.
- **Wording:** with registry versions (`web-registry-versions`), "Older test vault" would also label v2 vaults.

## What Changes

- The created vault goes to the Shell's vault list the moment it is saved, so the Shell's auto-lock covers the
  "saved" screen; the create flow keeps only public fields. Locking there wipes it and returns home.
- Dates walk the logs backward from `latest`, with pages that grow while the RPC accepts them and shrink when it
  refuses, at most 200 queries per registry; the newest event is found first, and the created date by the same
  bounded walk.
- STALE: `assertCurrent` re-reads twice before calling a vault STALE (a lagging RPC). The session's nonce is pinned
  only at open (two agreeing nonce reads around a vault read), moves only locally after a successful save, and never
  after a failed one. On STALE the app offers "Reload vault" (one unlock), which replaces the session. The on-chain fix
  (a compare-and-swap in a future VaultRegistry v3) is recorded as a follow-up.
- Unarchive uses the same zero-saves-left gate as every other save.
- A paged locator whose pages don't add up to `locatorLength` fails with "We couldn't load all of your vaults".
- Read-only vaults are "Read-only vault (older format)"; the read-only notice no longer says "test".
- `docs/compliance/data-inventory.md` and `docs/system-design.md` updated; vlla 6.1 ticked.

**Runtime dependencies:** none added. No CryoShield-operated backend.

**Out of scope:** the other open review items (WB5–WB9, W2, W5, RT*, S*), the dates cache across unmounts (WB7), and
any change to contracts or the recovery tool.

# Design: Web follow-ups from the final security reviews

## D1. The "saved" screen is under the Shell's auto-lock (N1, WEB-M2)

`CreateFlow` calls `onSaved(session)` as soon as the save is confirmed; the Shell puts it in `vaults` (the only place
decrypted vaults live, vlla D7), so its `useAutoLock(unlocked, lock)` runs: 5 min idle with the 30 s warning,
`pagehide`, 60 s hidden. `lock()` empties `vaults` and returns home, which unmounts the create flow. The flow clears
its own items and name on success and keeps only `{vaultId, version, blob}` (public) for the Arweave retry. Continue
opens the vault the Shell already holds.

*Alternative rejected:* a second auto-lock inside `CreateFlow` (two copies of the plaintext and two lock paths).

## D2. Dates: a bounded backward walk (WB1)

Per registry, from `latest` down to the deploy block. Page size starts at `range` (10,000), doubles after each
accepted page up to 128 × `range` (1.28M blocks, about 30 days on OP), and halves when the RPC refuses a page (a
refusal at the base size makes that registry's dates unavailable). At most 200 queries per registry, refused ones
included. Each vault leaves the query once its newest event and its `VaultCreated` are both found. Logs outside the
queried window or for another vault are ignored. Hostile-RPC bounds kept: abort before each page, the query cap, a
`latest` sanity bound (< 2^40), the timestamp range 1–4e9, and "Last saved" only when the newest event's version and
`blobHash` match the decrypted blob. 200 growing pages cover far more than any real chain; a vault not found within
the cap shows "Date unavailable".

## D3. Staleness: the pin never depends on RPC reads after a write (WB3, N2; ECC reviews of 86fbc66 and 88255e2)

*Revised 2026-10-08 after the ECC review of 88255e2 (HIGH): re-pinning after a write from two independent RPC reads
(the nonce, then `getVault`) could move the pin over a lagging node's old blob and let the next save overwrite a write
that had landed. The pin is now set only at open, and only locally after a write.*

- **At open (and after Reload, which remounts the view):** `pinIfCurrent` (initial chunk, raw `eth_call`s) reads the
  nonce, then the vault, then the nonce again, and pins only when both nonce reads are equal and the chain holds the
  session's own blob; one retry after 1.5 s; otherwise the session is unpinned-and-refused: Save, Edit vault,
  Unarchive and Add key show STALE and offer Reload, and nothing is sent.
- **After a failed attempt (any code):** the pin never moves, and nothing is read. The next save goes STALE (the write
  stack sees a nonce above the pin) and offers Reload. This trades WB3's convenience (a retry after a reverted save
  now needs a Reload) for never re-pinning from reads that may disagree.
- **After a successful save:** the pin moves locally to `pinned + 1n` with the session's new blob (`withPayload`,
  `saveAddKey`): our own operation used exactly that nonce. No RPC read.
- **`assertCurrent`** (write stack, unchanged): a nonce below the pin or a different blob is read again up to twice
  (lag); a nonce above the pin is STALE at once, never adopted.
- **Reload:** one unlock with the "touch your key" prompt; the same `registry:vaultId` replaces the session and the view
  is remounted (its key carries a reload counter, so no Show, mirror or heal state carries over; a version in the key
  would also remount after every save and drop the "Saved" status), the heading gets focus. An older version than the
  session is refused ("try again", L1); a key that doesn't open the vault keeps the session. A result after a lock is
  ignored (epoch). The Reload button sits under the error notice, not in a second action bar.

**Residual (honest).** All of this is client-side. A load-balanced RPC whose nodes lag can still mislead a single
client: for example, an open whose three reads all come from one lagging node pins a stale nonce and blob, and the
next save's own reads may come from that node too. The write is then still bounded by the EntryPoint nonce (a nonce
another write has used fails at the bundler, AA25), but a client that never saw that write can still build its save
from an old base. The real fix is on-chain: **`VaultRegistry` v3 should take an `expectedVersion` in `updateVault` (and
`addLocators`) and revert on mismatch (compare-and-swap)**, so a save built from version N can only replace version N.
Registries are immutable, so that needs a new v3 deployment (follow-up 4.1); `web-registry-versions` already lets the
app read and write a v3. Until then, Reload and the nonce bound are the mitigations.

## D4. Unarchive gate (WB4)

`disabled={busy || budget.blocked}` with "Saving is paused" next to it, like Save.

## D5. `locatorLength` is the source of truth (W1)

Each page must have exactly `min(256, length - start)` ids; otherwise `RegistryIncompleteError` (a subclass of
`RegistryUnconfirmedError`, so a newer registry's incomplete list is also "unconfirmed" for older copies). The UI says
"We couldn't load all of your vaults, so we didn't show a partial list."

## D6. Wording

"Read-only vault (older format)", "Read-only vaults (older format)", "Open a read-only vault (older format)", and
"This vault is in an older, read-only format. …". Assumption **A1:** this replaces the "Older test vault" text in the
`vault-list-labels-archive` delta when both are archived (apply this change after it).

## Threat model

| Attacker / failure | Can | Cannot | Mitigation |
|---|---|---|---|
| Someone at an unattended device after a create | Read the new vault on the "saved" screen | After 5 min idle, `pagehide` or 60 s hidden | D1 |
| Lagging or lying RPC | Delay dates; return a stale nonce or blob at open | Move the pin after a write (never read again), or reuse a nonce another write used (AA25) | D3. Residual: a client that never saw another write can build from an old base until VaultRegistry v3's compare-and-swap |
| RPC returning short pages | Hide vaults | Silently: the list fails instead | D5 |
| Hostile RPC on dates | Make dates unavailable | Unbounded queries, fake "Last saved" | D2 bounds and the blobHash check |

## Implementation notes (2026-10-08)

- Bundle: `pinIfCurrent` and `RegistryIncompleteError` stay in the initial chunk (opening a vault pins without the
  write stack, and the unlock path needs the error class); the baseline is not raised. Measured numbers are in the
  commit message.

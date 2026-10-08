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

## D3. No false STALE; fail safe (WB3, N2)

- `assertCurrent` (write stack): if the blob differs or the nonce is below the pin, re-read up to twice, 1.5 s apart
  (a load-balanced RPC lagging this session's own write). A nonce above the pin is a write from elsewhere: STALE at
  once, never adopted there.
- `pinIfCurrent` (initial chunk, raw `eth_call`s): reads the nonce, then the vault, and returns the nonce only if the
  chain holds the session's blob and the nonce is above the current pin. Used at open (instead of pinning blindly)
  and after every save attempt, successful or not. The App applies it only to the session whose blob was checked.
- Why this stays safe: the pin is only raised while the chain still holds exactly the blob this session decrypted
  (another device's save changes the blob, so it is never re-pinned over), and the operation still carries the nonce
  read right before signing, so a write that lands in between fails at the bundler (AA25) instead of overwriting.
- "Reload vault" on STALE: one unlock (`unlockSessions`), and the same `registry:vaultId` replaces the session; the
  draft is dropped (it was made from the old version). If that key doesn't open this vault, a message says so and
  the session is kept. A result after a lock is ignored (epoch).

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
| Lagging or lying RPC | Delay dates, return a stale nonce or blob | Make the app adopt another device's state as current, or overwrite it | D3: re-pin only on the session's own blob, never downward; the bundler nonce check |
| RPC returning short pages | Hide vaults | Silently: the list fails instead | D5 |
| Hostile RPC on dates | Make dates unavailable | Unbounded queries, fake "Last saved" | D2 bounds and the blobHash check |

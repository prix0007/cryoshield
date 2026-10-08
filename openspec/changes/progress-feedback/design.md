# Design

## D1. One component: `Progress` (motionkit)

`Progress({ label, steps, done, failed?, extra? })`.
- **`done`** is the number of finished steps. The caller derives it from the write path's `onProgress` stages (or
  unlock phases). `failed` marks the step at `done` as failed and stops the bar.
- **Bar:** a `role="progressbar"` track with `aria-valuemin=0`, `aria-valuemax=M`, `aria-valuenow=done` and
  `aria-valuetext` "Step N of M: <label>" (or "Done" / "Stopped at: <label>"). The fill is a Motion `scaleX` (the
  pattern the copy-countdown bar already uses under the CSP; no inline style attributes). Reduced motion: duration 0.
- **Steps:** the existing `.stage` list keeps `aria-label` "Save progress", the `stage-done` class and the ": done"
  screen-reader suffix, so the existing checks keep working. New states: `stage-current` (CSS spinner),
  `stage-failed` (an "!" in the error ink), `stage-todo` (the neutral dot).
- **Announcements:** one polite live region, the visible "Step N of M: <label>" line above the bar, whose text changes
  only when the step changes (the same string as `aria-valuetext`). The reassurance line is visible text, not live, so it never adds an announcement per tick.
- **Focus:** never moved (no autofocus inside the component).
- `SaveProgress` is replaced by `Progress`; `SAVE_STAGES` stays the source of the stage order.

## D2. Save steps

- **Existing vault** (edit, add key, rename/archive, unarchive, archive and clear): Touch your key → Encrypted →
  Sponsored → Signed and sent → Confirmed (5). "Touch your key" is done when `encrypted` is reported (the PRF tap is
  what makes encryption possible). The second, signing tap happens during "Signed and sent", with the existing key
  prompt.
- **Create:** the keys were tapped during setup and the only tap is the signing one, so the list starts at Encrypted
  (4 steps). Showing a "Touch your key" step that completes without a touch would be dishonest. *Assumption recorded
  for the overwatcher:* this is the only deviation from "a first step Touch your key".
- **Arweave:** an extra line under the list (not a step, not in the bar): "Backup copy saved to Arweave · in the
  background", with a spinner while pending, a check when saved and "not saved yet" on failure (MirrorLine keeps the
  retry). It appears once the save is confirmed, as today, and never delays "Saved".
- **Failure:** VaultView and CreateFlow keep the progress on failure with `failed` set (it used to disappear). Starting
  another save resets it. Create returns to the secrets step as before, with the stopped progress shown above the editor.

## D3. Reassurance

`useAfter(on, ms, key)` (true once `on` has held for `ms`, reset when `key` changes) drives "Still working… this can
take up to a minute." after 10 s on one step (`key = done`), not while failed or finished.

## D4. Unlock, Reload, Check another key, Lock

- `unlock()` gets an optional `onPhase('finding' | 'opening')` dependency, called after the PRF tap (before the
  registry lookup) and before decrypting. It changes nothing that is read, derived or wiped.
- `UnlockFlow`, `VaultView` (Reload) and `VaultsMenu` (Check another key) show `Progress` with the steps Touch your
  key → Finding your vaults → Opening, only once `useAfter(busy, 300)` is true. The key prompt shows at once as before
  (a ceremony is never delayed).
- **Lock:** the wipe stays synchronous in one state update; the screen fade and "Your vault is locked." are the
  feedback. A "Locking…" step would only delay a security action, so none is added.

## D5. Loaders

- `Loading({ text })`: a `role="status"` paragraph with `aria-busy="true"` that renders nothing for 300 ms, then a
  spinner and the text. It replaces the plain fallbacks for the vault list, the Edit vault sheet and the vault
  location panel.
- Vault dates: a spinner before "Loading dates…" in each row.
- **Spinner:** a CSS ring (`border-top-color` accent, `@keyframes spin`). Under `prefers-reduced-motion: reduce` the
  animation is off and the ring is static. Dark mode via app tokens.
- Copy and download have no user-visible wait (the clipboard write and the download are immediate), so they get none.

## D6. Bundle

The /app initial budget had 64 B of headroom after `vault-view-action-layout`. The progress component, the unlock
phases and the loaders are founder-requested UX shared by every flow; they cannot be lazy (a save's progress must
render before the write stack loads).

**Baseline raised by 1 KB (2026-10-08).** Measured gzip on 08a36fa (vault-view-action-layout after its review) → this
change after its review: e2e 203,870 → 204,703 B (+833 B), production 203,881 → 204,718 B (+837 B). The old cap
(203,905 B) is exceeded by about 810 B even after sharing the step icon between the list and the background line, so
`APP_BASELINE` gains 1,024 B (whole KB, as every earlier entry), leaving 211 B of headroom. The +20 KB Motion
allowance is unchanged. Recorded in `scripts/verify-build.mjs`.

## D7. ECC review fixes (2026-10-08)

- **H1:** `useAfter` clears its state in the effect cleanup, so it restarts whenever `on` drops or `key` changes: the
  300 ms anti-flicker delay and the 10 s reassurance wait again on an unlock retry and on a second save on the same
  mount.
- **M1:** no `aria-busy` on the progress card or on `Loading` (the progressbar and the step text carry the state).
- **M2:** the visible step line is `aria-hidden`; a separate polite region carries the same text, empty on
  "Touch your key" (the key prompt already announces it), so nothing is announced twice.
- **M4:** the create flow's idle wipe also clears the stopped progress (`saveFailed`, `reached`).
- **L2:** the step list has its own name ("Save steps" / "Opening steps"), distinct from the bar.
- **L3:** `finished` is false while failed, so a failure on the last step reads "Stopped at", never "Done".
- **L5:** a failed progress scrolls into view (`block: 'nearest'`); focus is not moved.

## Threat / abuse

No crypto, contract or paymaster change. `onPhase` is a UI callback with no data; progress shows only stage names,
never secrets, names or identifiers.

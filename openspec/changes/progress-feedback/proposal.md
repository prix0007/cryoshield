# Proposal: Progress feedback for saves and waits

## Why

The founder (2026-10-08): "Since it's a 5 step process where any tx is involved, let's make it so user can get some
feedback like progress bar or loaders or spinners. same when opening and closing etc."

Today a save shows a checklist (`SaveProgress`) with no sense of "how far along", no indication of the step in
progress, and nothing on failure (the checklist disappears). Unlocking shows only "Opening your vault…", and lazy
parts of the app show plain "Loading…" text.

## What Changes

- **One progress component for every save** (create, Save edit, Add a key, Rename or archive, Unarchive, Archive and
  clear): a determinate bar ("Step N of M") above a step list "Touch your key" → "Encrypted on this device" →
  "Network fee sponsored" → "Signed and sent" → "Confirmed on-chain". The current step has a spinner, finished steps a
  check, a failed step an error mark. Steps advance only on the write path's real callbacks.
  - After about 10 s on one step: "Still working… this can take up to a minute."
  - The Arweave copy is a separate "in the background" line that never blocks "Saved".
  - On failure the bar stops at the failed step, next to the existing error and retry.
- **Unlock and Reload:** "Touch your key" → "Finding your vaults" → "Opening", shown only when the wait passes 300 ms.
- **Lock:** the wipe stays synchronous and immediate; the existing screen fade and "Your vault is locked." are the
  feedback (no delay is added to a security action).
- **Loading:** a small CSS spinner, after a short delay, for the lazily loaded parts (vault list and its sheet, the
  vault location panel), for "Check another key" and per row for the vault dates.
- **Accessibility:** `role="progressbar"` with `aria-valuenow/min/max` and an `aria-valuetext` naming the step; one
  polite announcement per step change (none on "Touch your key", which the key prompt announces); `aria-busy` only on the vault-date rows while they load; focus is never moved; reduced motion gets a
  static indicator and an instant bar.

## Out of scope

- Copy and download (no wait the user can notice: the clipboard write and the file download are immediate).
- Any change to the write path, crypto, contracts or the paymaster (the progress only listens to existing callbacks;
  unlock gains an optional phase callback with no effect on what it reads or decrypts).

## Impact

- `apps/web/src/ui/motionkit.tsx` (the shared `Progress`, `Spinner`, `Loading`), `CreateFlow.tsx`, `VaultView.tsx`,
  `UnlockFlow.tsx`, `App.tsx`, `VaultsMenu.tsx`, `chain/unlock.ts` (optional `onPhase`), `strings.ts`, `global.css`;
  tests; `scripts/verify-build.mjs` (baseline, see design D6).
- **Runtime dependencies:** none added. No CryoShield-operated backend.

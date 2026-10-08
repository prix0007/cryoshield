# Proposal: Grouped actions under the vault

## Why

The founder (2026-10-08): "Below your vault data, we have too many buttons. can we organize them nicer." The open vault
shows one bar of six buttons (Edit, Edit vault, Add a key, All vaults (N), Details, Lock) with equal weight. The
founder chose the "Grouped sections" layout.

## What Changes

- The open vault (view mode) shows, under the secrets:
  - one full-width primary button, "Edit secrets", in the floating bar (hidden for read-only vaults);
  - a "Manage vault" section: a heading over an inset grouped list of rows ("Rename or archive", "Add a key",
    "Details & backup file"), each a full-width button with a chevron;
  - a navigation row: "All vaults (N)" (only when the vault list exists) and "Lock".
- Labels: "Edit vault" becomes "Rename or archive" and "Vault details" (the button) becomes "Details & backup file".
  "Edit secrets" is unchanged. The sheet and page headings they open are unchanged.
- Rows keep the existing modes, behaviour and read-only gating. Tests, E2E selectors and docs follow the new labels.

## Out of scope

- The vault list's own "Edit vault <name>" button and the "Edit vault" sheet heading (another screen).
- The edit, add-key, details and rename screens themselves.
- Any change to writes, crypto, contracts or the paymaster.

## Impact

- `apps/web/src/ui/VaultView.tsx`, `strings.ts`, `global.css`; unit and E2E tests; `apps/web/docs/hardware-test.md`.
- **Runtime dependencies:** none added. No CryoShield-operated backend.

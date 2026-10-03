# Proposal

## Why

The founder: "in landing page address the point that data remains with you and no one can read it except you unlike
other cloud provider services." The landing page says this only in passing, inside the tap scene. Visitors who know
cloud storage need a direct, honest comparison.

## What Changes

- **A new light tile, "Only you can read it."**, placed between "Stored on-chain. Copied to Arweave." (dark) and
  "Lose a key, not your vault." (dark), which keeps the light/dark rhythm. It holds:
  - the body copy the overwatcher checked;
  - an accessible comparison `<table>` with a caption, "Typical cloud storage" vs "CryoShield", four rows;
  - the fine-print disclaimer about end-to-end encrypted password managers, under the table.
- **Motion:** the rows reveal one by one as the table scrolls into view (CSS transitions armed by a small observer in
  the existing boot module). Under reduced motion, or with no JS, the table is static and fully visible.
- **Accuracy guardrails, enforced by a copy test:**
  - the fine print must be present;
  - no wording that the data "stays on your device" (the encrypted vault is public; the keys stay with you);
  - no competitor named;
  - the testnet/unaudited banner stays.

**Out of scope:** other landing sections; the app; analytics.

**Runtime dependencies:** none.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `landing-page`: "Story tiles" gains the "Only you can read it." tile and its comparison table.

## Impact

- `apps/web/index.html`, `src/landing/{boot,main}.ts`, `src/landing/landing.css`.
- Tests: the landing content test, the E2E landing spec (render, axe, reduced motion). Screenshots are updated.

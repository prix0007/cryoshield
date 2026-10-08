# Design

## D1. One column

Every top-level block of the open vault (the secret cards, the action bar, the Manage vault list, the All vaults
button and the location card) has the same left and right edge as the content column (`.app-main`'s content box).
Text inside them keeps its inset (`--space-lg`), so the Manage vault heading still lines up with the row labels.

## D2. The action bar stays a tray

The frosted pill tray stays (it is sticky and needs its own background). Only the negative side margin goes: the tray
is the column width and its button sits inside its padding. This applies to every `ActionBar` (create, unlock, edit,
add key, details), so the flows stay consistent.

## D3. Location card

`.vault-location-disclosure` gets the group-list surface. The disclosure button fills the row (`width: 100%`,
44 px target). The expanded `.vault-location` inside it drops its own border and background, so there is one card,
not a card in a card.

## D4. Footer

The divider moves from `.app-footer` (720 px box including its gutter) to its list, so it spans the content column.

## Test

An E2E check reads the bounding boxes of those blocks at 1024 px and 390 px and requires equal left and right edges
(±1 px). It fails on the current CSS (bar −12 px, All vaults narrower).

## Security review

N/A: CSS only; no crypto, contract, paymaster, secret-handling or CI change.

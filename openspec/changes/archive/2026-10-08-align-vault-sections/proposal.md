# Proposal

## Why

The founder: "in vault all sections must be aligned, some are bigger and some are smaller, can you fix all the
widths." Measured on the open vault (1024 px viewport), the secret cards and the Manage vault list span the content
column, but:

- the sticky action bar (Edit secrets) sticks out 12 px on each side (a negative side margin);
- "All vaults" is a content-sized pill;
- "Where your vault is stored" is a bare text link;
- the app footer's divider runs 17 px past the column on each side.

The same bar overhang shows in the add-key and details sheets, and at phone width.

## What Changes

- `.action-bar` keeps its tray look but no longer has negative side margins: its edges line up with the cards in every
  flow.
- "All vaults" becomes a full-width secondary button.
- "Where your vault is stored" becomes a full-width card row (surface, hairline, large radius, like the Manage list),
  with the location details expanding inside the same card.
- The app footer's divider spans the content column only.

CSS only, plus no markup change beyond class names already present. No copy, behaviour, CSP or bundle change.

## Impact

- Spec: `vault-web-app` (ADDED "Vault view column alignment").
- Code: `apps/web/src/ui/global.css`; E2E `apps/web/e2e/specs/18-vault-layout.spec.ts` (alignment check).

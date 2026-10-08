# Design

## D1. Same column on the list screen

`.vault-list` is a list of cards, not a bulleted list: it gets `list-style: none; padding-left: 0`. `.plain-list`
keeps its indent for real bulleted lists (the add-key explanation, the create-flow notes). The cards' inner padding is
unchanged, so their text stays inset like the other cards.

## Test

`18-vault-layout.spec.ts` opens All vaults and requires the vault cards, the section heading and the action bar to
share the column's left and right edges (±1 px) at 1024 px and 390 px. It fails on the current CSS (cards +24 px).

## Security review

N/A: CSS only; no crypto, contract, paymaster, secret-handling or CI change.

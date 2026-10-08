# Proposal

## Why

The founder, after `align-vault-sections` went live on dev: "All vaults, still have some misalignment, rest looks
fine." Measured on the All vaults screen (1280 px), each vault card starts 24 px right of the heading, the banner and
the action bar (x = 321 vs 297), because `.vault-list` also carries `.plain-list`, whose bullet-list left padding
indents it. The earlier change only covered the open vault.

## What Changes

- `.vault-list` drops the bullet-list indent (`padding-left: 0`, no list markers), so the vault cards span the content
  column like every other block.
- The "Vault view column alignment" requirement also covers the All vaults screen; the E2E alignment check gains that
  screen at 1024 px and 390 px.

CSS only. No copy, behaviour, CSP or bundle change.

## Impact

- Spec: `vault-web-app` ("Vault view column alignment" modified).
- Code: `apps/web/src/ui/global.css`; E2E `apps/web/e2e/specs/18-vault-layout.spec.ts`.

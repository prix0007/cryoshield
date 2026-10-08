# Tasks

## 1. Tests first

- [x] 1.1 E2E `18-vault-layout.spec.ts`: on the open vault at 1024 px and 390 px, the secret cards, action bar, Manage vault list, All vaults button and location card share left and right edges (±1 px); the footer divider stays within the column. Verify it fails first.

## 2. Build

- [x] 2.1 `global.css`: `.action-bar` without negative side margins; full-width `.vault-nav` button; `.vault-location-disclosure` as a card with a full-row toggle; footer divider on the list.

## 3. Verification

- [x] 3.1 Web unit suite, typecheck, lint, build, `verify-build`, E2E (vaults, flows, a11y, motion), screenshots reviewed in light and dark, `openspec validate --all --strict`.

# Manual hardware checklist (task 9.3)

Target: **OP Sepolia (chain 11155420)**, the testnet (`openspec/changes/target-op-sepolia`).
- Build with `apps/web/.env.example` values: `VITE_CHAIN_ID=11155420`, `VITE_RPC_URL=https://sepolia.optimism.io`,
  Pimlico `https://api.pimlico.io/v2/optimism-sepolia/rpc?apikey=…`, with the sponsorship policy applied.
- The build needs `contracts/deployments/11155420.json` from the real deploy.
- Serve over HTTPS from the staging RP ID host.

Keys: two YubiKey 5 (firmware ≥ 5.2, FIDO2 PIN set), plus one third key, plus one key with firmware < 5.2 if available.
Browser: desktop Chrome (latest).

| # | Step | Expected | Result |
|---|---|---|---|
| 1 | Create a vault with key A and key B (PIN prompts appear) | "Your vault is saved"; "Backup copy saved" | not run |
| 1a | **On-chain check of step 1:** open the create transaction on the OP Sepolia explorer | the userOp succeeded through EntryPoint v0.6 and deployed the CBSW v1.1 account. Its WebAuthn signature was verified by the RIP-7212 `0x100` precompile via `staticcall` (target-op-sepolia design fact 1a): the trace shows a call to `0x100` returning `…01`, with no FreshCryptoLib fallback. | not run |
| 2 | Fresh browser profile, unlock with key A only | one touch; secrets listed, hidden until Show | not run |
| 3 | Fresh browser profile, unlock with key B only | same | not run |
| 4 | Edit with key B (touch, then touch again) | "Saved."; unlock with A shows the edit | not run |
| 5 | Add key C using key A (Continue at each key swap) | "Your new key is ready"; unlock with C alone works | not run |
| 6 | Old-firmware key (< 5.2) at "Set up key 1" | "This key is too old…" | not run |
| 7 | Arweave GraphQL `CryoShield-Locator = <locator>` | returns the latest blob | not run |
| 8 | Desktop recovery tool (`--testnet` = op-sepolia) opens the vault with A (site offline) | secrets shown | not run |
| 9 | Record gas/USD per write in `docs/costs.md` | filled | not run |

## harden-gas-sponsorship (task 6.3): UV-enforcing account and VaultRegistry v2

Run on the dev site (`https://cryoshield-web-dev.fly.dev`, RP ID `cryoshield-web-dev.fly.dev`) and on the production
testnet build. Both need `contracts.vaultRegistryV2` and `contracts.wallets.<their RP ID>` in
`contracts/deployments/11155420.json` (task 6.1); the build refuses to start otherwise.

| # | Step | Expected | Result |
|---|---|---|---|
| H1 | Create a vault with key A and key B (PIN at each touch) | "Your vault is saved". On the explorer, the userOp's `initCode` factory is `contracts.wallets.<RP ID>.factory` (not Coinbase's `0xba5ed110…`), and the account's implementation slot holds `contracts.wallets.<RP ID>.implementation` | not run |
| H2 | On the explorer, the create calls **VaultRegistry v2** `createVault(salt, …)`; the emitted vaultId equals the one under "Details & backup file" | the same id | not run |
| H3 | Unlock with A, then with B (fresh profiles) | one touch each; secrets shown | not run |
| H4 | Edit with B; add key C with A | "Saved."; C alone unlocks | not run |
| H5 | Unlock with a key whose vault exists only in VaultRegistry v1 (the old test vault) | it opens; secrets can be shown and copied; no Edit or Add key; the notice "This vault was made with an earlier test version…" | not run |
| H6 | Re-create the old test vault on v2 with the same keys (task 6.4), then unlock | the v2 vault opens directly (no picker) with Edit; "Open an older test vault" shows the v1 copy read-only; "Back to your current vault" returns | not run |
| H7 | Pimlico dashboard: temporarily set the per-sender count to the sender's current count, then edit | "Saving is paused right now…"; nothing sent; unlock still works. Restore the cap | not run |
| H8 | Recovery tool reads the v1 and the v2 vault | both open | not run |
| H10 | After H4, open "Where your vault is stored" (show-vault-onchain-location) | network "OP Sepolia testnet (chain ID 11155420)"; registry = `contracts.vaultRegistryV2`, Version 2; vault ID = the one under "Details & backup file"; the Vault account link opens `testnet-explorer.optimism.io/address/<owner>` in a new tab; the Last save link opens the edit's transaction; Copy puts the full value on the clipboard; no locator is shown; after Lock the panel is gone | not run |
| H9 | Record gas and USD per create / edit / add-key in `docs/costs.md` and `contracts/GAS.md`; re-check the D2 per-operation caps | filled | not run |

## vault-list-labels-archive (task 6.2): two vaults on two keys, names and archive

Run on the dev site (`https://cryoshield-web-dev.fly.dev`) against OP Sepolia, with **key A** and **key B** only, a
fresh browser profile, and a second browser (or profile) for V10. Every vault below is created with both keys, so each
key holds one credential per vault: when the browser asks which passkey to use, it lists one per vault. Use the
recovery tool with `--testnet` from a checkout that has `--list` (`tools/recover`). Record the date, the build's
`/release.json` commit and each vault ID next to the results.

| # | Step | Expected | Result |
|---|---|---|---|
| V1 | Create a vault with keys A and B, name it "Family" in the optional name field, and add one secret | "Your vault is saved". The heading shows "Family". The key labels shown by the browser or OS read "CryoShield vault · <Mon YYYY> (key 1)" / "(key 2)": the month only, never the name | not run |
| V2 | Lock, then create a **second** vault with the same keys A and B, name it "Work", and add two secrets | "Your vault is saved"; the heading shows "Work". Its vault ID ("Details & backup file") differs from V1's | not run |
| V3 | Lock. Unlock with key A and choose the "Family" vault's passkey in the browser's chooser | one touch; "Family" opens directly (it is the only active vault for that credential); the header offers "All vaults (1)" | not run |
| V4 | "All vaults (1)" → **"Check another key"**: touch key A again and choose the "Work" passkey | "Your vaults" lists both, under "Active vaults", with no duplicate. Each row shows its name, "Active", the secret count ("1 secret" / "2 secrets"), the first labels, "any 1 of 2 keys", and Created / Last saved dates (or "Date unavailable"). Then repeat "Check another key" with key B's "Family" passkey: "That key didn’t open any other vault." | not run |
| V5 | From the list, open "Work" → "Edit vault": rename it to "Work 2FA" **and** tick "Archive this vault", then Save (one touch to unlock editing, one to save) | one update only: one new transaction on the explorer, not two. The heading reads "Work 2FA". "This vault is archived." shows with "Unarchive". In the list it has moved under "Archived vaults" and is still listed. The sheet says "Any one of this vault’s keys can rename, archive or clear it." | not run |
| V6 | Lock. Unlock with key B and choose the "Work 2FA" passkey (its only vault is now archived) | the list opens with the archived section expanded and the note "This key’s vault is archived." Nothing opens on its own, and the app never says no vault was found | not run |
| V7 | Open "Work 2FA" → **"Unarchive"** | one update; the archived notice is gone; in "All vaults" the vault is back under "Active vaults", still named "Work 2FA" | not run |
| V8 | On "Family": "Rename or archive" → **"Archive and clear…"**. Check that the button stays disabled until "I understand old versions stay readable" is ticked; read the three points; then press "Archive and clear" | one update. The vault opens with no secrets, is archived and keeps the name "Family". On the explorer, the new blob has the **same length** as the previous one. The copy says earlier versions stay in public chain history and on Arweave, that anyone with one of the vault's keys and its PIN can still read them, and to change the secret at its source | not run |
| V9 | "All vaults" → open "Family", then "Unarchive" and add a secret | it saves; the vault is active again with the new secret (the padding is dropped on this save) | not run |
| V10 | STALE: open "Work 2FA" in browser 1 and in browser 2 (key A). Save an edit in browser 2, then try to save a different edit in browser 1 | browser 1 stops **before any key touch** (the check runs again just before signing): "This vault changed since you opened it, maybe on another device. Nothing was saved." "Reload vault" (one touch) shows browser 2's edit. No second transaction is sent | not run |
| V11 | Recovery tool, key A: `cryoshield-recover --testnet --list` | exit code 0. Both vaults are listed with their IDs, status (`[ACTIVE  ]` / `[ARCHIVED]` as left by V5–V9), item and key counts, freshness, the source line ("built-in registry v2") and the names in quotes. No item label and no secret value is printed | not run |
| V12 | Recovery tool, key A: `cryoshield-recover --testnet` (the interactive chooser) | the same list, numbered; choose "Work 2FA". Its status, name and up to 10 labels are shown above the prompt, and no secret value before you type `show`. After `show`: `----- BEGIN SECRETS (status: ACTIVE; vault: "Work 2FA") -----` and one `  - label: secret` line per item. The same run with `--output out.txt` and no terminal (`</dev/null`) exits 12 and prints only IDs and freshness | not run |
| V13 | Privacy spot check during V1–V9 (DevTools) | no vault name or label in the console, `document.title`, the URL, analytics requests, localStorage, sessionStorage or IndexedDB; after Lock, "Your vaults" and every vault in it are gone | not run |

Arbitrum Sepolia (421614) stays a supported preset: rebuild with its `VITE_*` values and
`contracts/deployments/421614.json`. No live Arbitrum run is planned.

Status: **not executed.** There is no Pimlico project, OP Sepolia deployment, or physical keys yet.

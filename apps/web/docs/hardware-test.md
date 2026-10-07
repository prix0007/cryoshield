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
| H2 | On the explorer, the create calls **VaultRegistry v2** `createVault(salt, …)`; the emitted vaultId equals the one under Vault details | the same id | not run |
| H3 | Unlock with A, then with B (fresh profiles) | one touch each; secrets shown | not run |
| H4 | Edit with B; add key C with A | "Saved."; C alone unlocks | not run |
| H5 | Unlock with a key whose vault exists only in VaultRegistry v1 (the old test vault) | it opens; secrets can be shown and copied; no Edit or Add key; the notice "This vault was made with an earlier test version…" | not run |
| H6 | Re-create the old test vault on v2 with the same keys (task 6.4), then unlock | the v2 vault opens directly (no picker) with Edit; "Open an older test vault" shows the v1 copy read-only; "Back to your current vault" returns | not run |
| H7 | Pimlico dashboard: temporarily set the per-sender count to the sender's current count, then edit | "Saving is paused right now…"; nothing sent; unlock still works. Restore the cap | not run |
| H8 | Recovery tool reads the v1 and the v2 vault | both open | not run |
| H10 | After H4, open "Where your vault is stored" (show-vault-onchain-location) | network "OP Sepolia testnet (chain ID 11155420)"; registry = `contracts.vaultRegistryV2`, Version 2; vault ID = the one under Vault details; the Vault account link opens `testnet-explorer.optimism.io/address/<owner>` in a new tab; the Last save link opens the edit's transaction; Copy puts the full value on the clipboard; no locator is shown; after Lock the panel is gone | not run |
| H9 | Record gas and USD per create / edit / add-key in `docs/costs.md` and `contracts/GAS.md`; re-check the D2 per-operation caps | filled | not run |

Arbitrum Sepolia (421614) stays a supported preset: rebuild with its `VITE_*` values and
`contracts/deployments/421614.json`. No live Arbitrum run is planned.

Status: **not executed.** There is no Pimlico project, OP Sepolia deployment, or physical keys yet.

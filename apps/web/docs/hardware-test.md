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

Arbitrum Sepolia (421614) stays a supported preset: rebuild with its `VITE_*` values and
`contracts/deployments/421614.json`. No live Arbitrum run is planned.

Status: **not executed.** There is no Pimlico project, OP Sepolia deployment, or physical keys yet.

# Manual hardware checklist (task 9.3)

Target: Arbitrum Sepolia, Pimlico policy applied, app served from the staging RP ID host over HTTPS.
Keys: two YubiKey 5 (firmware ≥ 5.2, FIDO2 PIN set), plus one third key, plus one key with firmware < 5.2 if available.
Browser: desktop Chrome (latest).

| # | Step | Expected | Result |
|---|---|---|---|
| 1 | Create a vault with key A and key B (PIN prompts appear) | "Your vault is saved"; "Backup copy saved" | not run |
| 2 | Fresh browser profile, unlock with key A only | one touch; secrets listed, hidden until Show | not run |
| 3 | Fresh browser profile, unlock with key B only | same | not run |
| 4 | Edit with key B (touch, then touch again) | "Saved."; unlock with A shows the edit | not run |
| 5 | Add key C using key A | "Your new key is ready"; unlock with C alone works | not run |
| 6 | Old-firmware key (< 5.2) at "Set up key 1" | "This key is too old…" | not run |
| 7 | Arweave GraphQL `CryoShield-Locator = <locator>` | returns the latest blob | not run |
| 8 | Desktop recovery tool opens the vault with A (site offline) | secrets shown | not run |
| 9 | Record gas/USD per write in `docs/costs.md` | filled | not run |

Status: **not executed.** There is no Pimlico project or Sepolia deployment yet.

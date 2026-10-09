# OP Mainnet launch: communications

**Prepared, not published.** These are the texts of OpenSpec change `launch-op-mainnet` (design → Communications and
copy plan, task 5.4). The founder publishes them at the steps named below; agents never do. The copy test
`apps/web/test/landing/comms.test.ts` runs the site's honesty denylist over this file.

Principles: say exactly what changed and what did not. CryoShield has not been independently audited, and no audit is
claimed or promised. "Permanent" always comes with: only your keys can open it, and if you lose every key, nobody,
including CryoShield, can open it.

## Before the switch

The first `v*` release deploys straight to OP Mainnet (founder, 2026-10-09; design D3, Sequencing B), so the live
site never shows this notice: production stays on the 2026-10-05 build until the switch. Publish it instead in the
README status line and a GitHub discussion a few days before launch day.

> CryoShield is moving to OP Mainnet. Vaults created during the testnet preview will not move; you can still read them with the recovery tool. Create a new vault after the switch.

## At the switch

What the site says on OP Mainnet (built from the chain; tested in `apps/web/test/landing/content.test.ts` and
`apps/web/test/ui/network-notice.test.tsx`):

- Landing page: "Runs on OP Mainnet. Your vault is encrypted on your device and stored on OP Mainnet, with an extra
  copy on Arweave when that upload succeeds. CryoShield has not been independently audited, so please keep your
  existing backups too."
- App: "CryoShield runs on OP Mainnet and has not been independently audited. Your vault is encrypted on your device and published permanently as ciphertext on a public blockchain, and only your keys can open it: if you lose every key, nobody, including CryoShield, can open it. Please keep your existing backups too."
- App, when a key has no vault on OP Mainnet (for 90 days after the switch):

> Vaults created during the testnet preview are not on OP Mainnet. They are still there, and you can read yours with the open-source recovery tool and its --testnet option. To use CryoShield on OP Mainnet, create a new vault.

## Release notes template for vA

Fill in the bracketed values from `contracts/deployments/10.json` and the recovery-tool release, then paste as the body
of the GitHub release `vA` (published by the owner at runbook step 7, after the OP Mainnet values are set; the notes are
edited to this text before the announcement, step 14).

```markdown
## CryoShield now runs on OP Mainnet

Vaults are stored on OP Mainnet (chain 10), with an extra copy on Arweave. Saving is free for you: CryoShield
sponsors the network fees, up to limits that reset over time. If a save is refused, nothing was saved and your vault
is unchanged.

**Audit status:** CryoShield has not been independently audited. The code, the vault format and the test vectors are
open source, and our internal security reviews are public in docs/reviews.

**Your keys:** only the security keys you enrol can open your vault. If you lose every key, nobody, including
CryoShield, can open it. Enrol at least two keys and keep them in different places.

**Testnet preview vaults** stay on OP Sepolia and were not moved. Read them with the recovery tool's `--testnet`
option, then create a new vault on OP Mainnet.

### Contracts on OP Mainnet (immutable, no admin)

| Contract | Address | Source verified on |
|---|---|---|
| VaultRegistry v2 | [registry v2 address] | Blockscout, Sourcify, Etherscan |
| CryoShield wallet factory (`cryoshield.app`) | [factory address] | Blockscout, Sourcify, Etherscan |
| CryoShield wallet implementation | [implementation address] | Blockscout, Sourcify, Etherscan |

The addresses equal the OP Sepolia ones (CREATE2; expected registry v2 `0xA622c92d3D5b54aeA081Cf410224a8A2eCb08cB7`,
factory `0x775dc816594262274E78Ae75D97C8EdB0df5DfED`, implementation `0x8aA76FaA6629cA1EA8ccC3F9Edf0E8D98816Acd7`).
Explorer links: https://explorer.optimism.io/address/[address] and https://optimistic.etherscan.io/address/[address].
There is no VaultRegistry v1 on OP Mainnet.

### Recovery tool

Recovery tool [version] reads OP Mainnet by default and OP Sepolia with `--testnet`. It needs only public RPCs or
Arweave and one of your keys, not this website. SHA-256 of the release files: [hashes].
```

## Announcement (after the soft launch)

Published at runbook step 14, after the 7-day soft launch with no threshold crossed (or each crossing handled).

> CryoShield now runs on OP Mainnet. It backs up a seed phrase or 2FA recovery codes, sealed in your browser and
> stored on a public blockchain with a copy on Arweave. Only the security keys you hold can open it: if you lose every
> key, nobody, including CryoShield, can open it, so enrol two keys, each with a PIN, and keep them in different
> places.
>
> CryoShield never sees your secrets or your keys, and runs no server of its own. If the site disappears, the
> open-source recovery tool opens your vault from public data with one of your keys.
>
> CryoShield has not been independently audited. The code, the vault format and the test vectors are open source;
> please keep your existing backups too. Saving is free for you: CryoShield pays the network fees up to limits that
> reset over time. If a save is refused, nothing was saved and your vault is unchanged. Report security issues
> privately through GitHub (SECURITY.md).

## Incident wording

- **Sponsorship limit reached (OP Mainnet):** the app's own message, under the title "Saving is paused":

> CryoShield could not pay the network fee for this save. Nothing was saved and your vault is unchanged. Sponsorship limits reset over time; if you’re adding a new secret, keep it somewhere safe until it saves.

- **Contract problem:** "We found a problem in [component]. Your vault is safe and readable with the recovery tool. We
  have paused saving while we fix it."
- **Anything involving user data:** follow the incident runbook of `add-privacy-and-compliance`.

## Checklist before publishing

- [ ] The bracketed values are filled in from `contracts/deployments/10.json` and the recovery-tool release.
- [ ] `/release.json` on https://cryoshield.app shows chain 10 and the commit of `vA`.
- [ ] The copy test still passes on this file after any edit.

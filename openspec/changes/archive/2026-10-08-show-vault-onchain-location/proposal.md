> **Archive after:** add-web-app (this change ADDS requirements to `vault-web-app`, which is not yet in `openspec/specs/`).

# Proposal

## Why

Founder request, 2026-10-07: "we do now show where is our deployed onchain vault, we should show that in app as well".

Once a vault is open, the app shows the secrets but not where the locked vault actually lives. Users can't check for
themselves that it exists on the public chain and on Arweave. Recovery without CryoShield (the desktop tool, a block
explorer, or a plain gateway download) is also easier when the user has written down the vault's public coordinates.

## What Changes

- **"Where your vault is stored"** is a disclosure on the open-vault view, collapsed by default. When the user opens it,
  it shows only public facts the app already has in memory:
  - the network name and chain ID;
  - the vault registry address, and whether it is version 2 or the read-only version 1;
  - the vault ID;
  - the vault's account address (the on-chain owner);
  - the current version number;
  - the last save's on-chain record, but only when this session made that save (the write path already returns it);
  - the Arweave copy's ID, but only when this session uploaded the copy or confirmed it byte for byte.
- **Copy and links:** every value has a Copy button. Addresses and the last save link to the network's block explorer,
  and the Arweave copy links to the configured gateway. Links open in a new tab, only on click, with
  `rel="noopener noreferrer"`.
- **Honest note:** "Anyone can see that this encrypted vault exists at this address; only your keys can open it."
- **Explorer config:** a per-chain network table (`apps/web/src/config/networks.ts`) gives the display name and the
  explorer base URL. The build puts the configured chain's entry into the runtime config. On a chain without an
  explorer (the local anvil chain), the section shows no explorer links.
- **Bundle:** the section's content is a lazily loaded chunk, fetched only when the disclosure is opened.

**Out of scope:**
- any new chain or Arweave query (no `eth_getLogs` scan for past saves, no GraphQL lookup just for this section);
- key locators, credential IDs, salts, PRF output or any other key material (locators are public but link a vault to a
  key, so they are never shown);
- the "Vault details" download screen, which is unchanged;
- `tools/recover`;
- `config/chain-presets.json`, which is shared with contracts and the recovery tool and has parity tests (see design D1).

**Runtime dependencies:** none. Explorer and gateway links are top-level navigations the user starts, not fetches, so
`connect-src` and every other CSP directive are unchanged. Nothing here is a CryoShield-operated backend.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `vault-web-app`: ADDED requirement "Public vault location". The capability's requirements are still in the
  unarchived `add-web-app` change, so this change archives after it.

## Impact

- Code (`apps/web`):
  - `src/config/networks.ts` (new);
  - `vite-plugins/cryoshield.ts` and `src/vite-env.d.ts` (runtime `network`);
  - `src/ui/{services,operations,VaultView,CreateFlow,strings,clipboard,global.css}`;
  - `src/ui/VaultLocation.tsx` (new, lazy);
  - `src/mirror/mirror.ts` (`ensure()` also returns the item ID it confirmed or uploaded).
- Tests: unit and RTL (content, links, copy, lock wipe, jargon, axe), mirror and config tests, and one E2E check in
  `10-flows.spec.ts`.
- Docs: `docs/system-design.md`.

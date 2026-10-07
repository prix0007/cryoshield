# Design

## Context

The open-vault view holds a `VaultSession` in memory: vault ID, owner account, version, blob and registry version.
The build already knows the chain ID, the registry v1/v2 addresses and the Arweave gateway. The write path
(`account/writes.ts`) already returns the transaction hash of a confirmed save, and the mirror already knows the
item ID it uploaded, or the one it byte-verified in `ensure()`. Everything this section shows is therefore already in
memory, apart from a display name and an explorer URL per chain.

## Decisions

### D1. The network table lives in `apps/web/src/config/networks.ts`
**Assumption (labelled):** the brief suggested `config/chain-presets.json`. That file is shared with
`contracts/script/deploy.sh` and `tools/recover`, and both enforce parity with it in tests. It also lives outside
`apps/web`. Adding a UI-only field there would cross ownership boundaries, so the web app keeps its own table, keyed by
chain ID:

| Chain ID | Name | Explorer |
|---|---|---|
| 11155420 | OP Sepolia testnet | `https://testnet-explorer.optimism.io` |
| 10 | OP Mainnet | `https://explorer.optimism.io` |
| 421614 | Arbitrum Sepolia testnet | `https://arbitrum-sepolia.blockscout.com` |
| 42161 | Arbitrum One | `https://arbitrum.blockscout.com` |
| 31337 | local test chain | none |

The OP hosts are the canonical Blockscout hosts the repo already uses (`contracts/script/deploy.sh`);
`optimism-*.blockscout.com` 301-redirects to them. The Vite plugin puts the configured chain's entry into the runtime
config as `network: { name, explorerUrl }`, and the architecture page reuses the same names. An unknown chain gets
`chain <id>` and no explorer. A future follow-up could move the explorer column into `chain-presets.json` with the
contracts and recovery owners.

### D2. Only data already in memory
- **Last save:** `VaultSession.lastSave = { version, txHash }` is set by create, edit and add-key when the write returns
  a hash. It is shown only if `lastSave.version === session.version`. After a plain unlock it is absent, and no
  `eth_getLogs` scan is added to find it (public RPCs limit log ranges, and the planned `vault-list-labels-archive`
  date lookup is a separate change).
- **Arweave copy:** `mirror.ensure()` now returns `{ state, id }`, the item it byte-verified or uploaded, and
  `ensureMirror` passes it through as `itemId`. Upload results already carried it. The view keeps
  `{ version, id }` and shows it only for the current version. An ID is shown and linked only if it matches the
  43-character base64url form of an Arweave ID.

### D3. Lazy content
`/app`'s initial JS is about 1.5 KB under its budget. The disclosure button stays in the main bundle, and its panel
content (`VaultLocation.tsx`) is loaded with `React.lazy` when the user opens it. It is a same-origin chunk, so the
existing `script-src 'self'` and Trusted Types policy apply unchanged.

### D4. Copy without the secret auto-clear
These values are public, so the copy uses a plain `writeText` (`copyPublic`). It doesn't take over the 30-second
secret-clear timer or its callback, so copying an address never cancels the scheduled clear of a secret copied
earlier.

### D5. Presentation
The section uses the existing `Disclosure` (Motion `Collapse`) and a `<dl>`. Long values show as `0x1234…abcd` in
monospace. The full value is in visually hidden text, in the link's accessible name and in the copied text. Links name
their destination and say they open in a new tab. Copy buttons read "Copy <label>", so the visible "Copy" is part of the
accessible name (WCAG 2.5.3). The strings avoid the banned jargon, so the last save is "Last save", not "transaction".

## Threats and abuse

- **Linkability:** locators connect a vault to a key and are never shown. Everything shown is already public on-chain
  and visible to anyone who knows the vault ID.
- **Link injection:** link targets are built from build-time constants plus values checked against strict formats
  (`0x` + 40 hex for an address, `0x` + 64 hex for a hash, 43-character base64url for an Arweave ID). Anything else is
  shown without a link.
- **Tabnabbing and referrer leakage:** `target="_blank"` with `rel="noopener noreferrer"`. The app already sets
  `Referrer-Policy: no-referrer`.
- **Silent network calls:** links are navigations started by the user. No fetch or prefetch is added, so the CSP is
  unchanged (verify-build checks it).
- **After lock:** the content is derived from the session, which `lock()` drops. The view unmounts and its mirror state
  goes with it.

# Design

## Decisions

### D1. One source, validated at build
`config/donation.json` lives at the repo root, next to the other config. `vite-plugins/donation.ts` `loadDonation()`
requires:
- exactly four fields;
- 20 bytes of hex whose EIP-55 checksum (viem `getAddress`) equals the file's casing exactly;
- `chainId` 1, network "Ethereum mainnet" and asset ETH.

Anything else throws, so the build fails. The README carries the same address. A test asserts the README's only
0x40-hex string is the configured one, and CI's `web` filter includes `config/donation.json` and `README.md`.

### D2. Static `/support`, no wallet code
A static page is simpler and safer than a dialog on `/`:
- it gets the app CSP (no new `connect-src`), every header and no analytics;
- the only script is a same-origin module for Copy, which never reads, writes or probes `window.ethereum`;
- "Open in wallet" is a plain `ethereum:` link (EIP-681), which needs no script and no CSP change.

### D3. The button
- **Pill:** a secondary pill in Action Blue (the site footer is parchment in both themes, so it's AA), with an
  inline-SVG cup.
- **Steam:** three short bars rise on `:hover` or `:focus-visible`, as a CSS keyframe gated on
  `prefers-reduced-motion: no-preference`.
- **Sheen (landing only):** a translucent bar (`currentColor` at low opacity, not a gradient) that `motion/mini`
  `animate()` sweeps once per hover or focus. It's a lazy chunk fetched on first use (about 3 KB gzip; full `motion`
  was about 18 KB), and it's off under reduced motion.
- **Other pages:** a compact text link "☕ Buy me a coffee", with the emoji `aria-hidden` so the name is "Buy me a
  coffee".

### D4. QR at build time
`qrcode-generator` (MIT, pinned 2.0.4, devDependency) encodes `ethereum:<address>@1` at error-correction level M.
`qrSvg()` emits one `<path>` of 1×1 modules with a 4-module quiet zone, a `<title>`, `role="img"`, no links and no
script.
- **Verified:** tests decode the SVG with `jsqr` (pinned 1.4.0, test-only), from both the generator output and the
  **built** `/support` HTML, back to exactly the URI.
- **Colours:** the QR stays black on white in both themes, for scanners.

### D5. Copy
- **Clipboard API first;** on failure it selects the address and calls `execCommand('copy')`. If that fails too, it
  leaves the address selected and says so.
- **Never cleared:** the clipboard isn't cleared, because the address is public.
- **Progressive enhancement:** the button is hidden until JS wires it. The address stays selectable
  (`user-select: all`).

## Threat model: address swap

The asset is donors' ETH. The attack is any change that makes a donor pay an address other than the founder's.

| Threat | Mitigation |
| --- | --- |
| A malicious or mistaken commit changes the address | A single source; the exact value pinned in a unit test, with its EIP-55 checksum; the README must match (also tested). Review sees a diff to a dedicated file. |
| Someone adds a second address in a donation context (page text, a hidden element, the QR, a URI) | verify-build's anti-swap check: no other 0x40-hex on `/support`; every `data-donation-address` and `ethereum:` URI in any HTML/JS must equal the config; the QR is decoded in tests from the built HTML. |
| Casing tampering (a valid address with an invalid checksum, or all lowercase) | `loadDonation` requires the exact EIP-55 casing; the anti-swap check compares strings case-sensitively. |
| A compromised CDN or third-party script rewrites the page | No third-party script; the CSP is `script-src 'self'`; Trusted Types is enforced; no analytics on `/support`. |
| A tampered deployment | Donors are told to cross-check the address against the GitHub README, which is a separate channel. The QR and wallet link carry the same address, so a mismatch is visible. |
| A wrong network or token | Chain ID in the URI (`@1`), a prominent warning, and non-refundability stated. |
| Clipboard hijacking by malware on the donor's device | Out of our control; the cross-check warning tells donors to verify what they paste. |
| Wallet-drainer patterns | No wallet connection, no `window.ethereum`, no signing requests: the site never asks a wallet to do anything. |

## Risks / Trade-offs

- **[Changing the address later needs three edits]** (the config, the README and the test constant) → that's the
  point: a change must be deliberate and visible in review.
- **[Landing initial JS grows by about 0.14 KB]** for the hover wiring → it stays well within the 15 KB budget.

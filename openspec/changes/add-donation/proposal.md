# Proposal

## Why

The founder asked for a "Buy me a coffee" button, made visually cool, that takes ETH on Ethereum mainnet at
`0xfb4172e26AC8735C06656f1df14151cFe8441481`. The coordinator verified the address: an exact EIP-55 checksum, an EOA
and no ENS name.

A donation address is a high-value target: anyone who can change it on the page redirects every donation. So the
change is built around a single, checked source and an anti-swap check, not just a button.

## What Changes

- **Single source:** `config/donation.json` (address, chainId 1, network, asset). The build reads and validates it:
  exact EIP-55 casing, chain 1 and ETH. A wrong value fails the build. The README publishes the same address under
  "Support the project", so people can cross-check it against GitHub, and a test keeps the two equal.
- **`/support`:** a static page with the same headers and app CSP as `/privacy`, and no analytics. It has:
  - the address in monospace;
  - a **build-time inline-SVG QR code** of the EIP-681 URI `ethereum:<address>@1`, generated with the pinned MIT
    `qrcode-generator` (a devDependency; nothing ships at runtime);
  - an "Open in wallet" link with the same URI;
  - a Copy button: clipboard API with a selection fallback, never cleared, and shown only when JS runs;
  - the network warning and the README cross-check;
  - honest donation terms.
- **"Buy me a coffee":**
  - **Landing page:** an Action Blue secondary pill in a footer band. Its cup's steam rises on hover or focus (CSS),
    and a Motion sheen sweeps across it (`motion/mini`, about 3 KB gzip, loaded lazily).
  - **Every page:** a compact footer link (landing, `/app`, legal, `/architecture`, `/devices`, `/support`).
  - **Reduced motion:** both effects are static.
- **No wallet code:** no wallet-connect library, no `window.ethereum`, no new `connect-src` host. The CSP is unchanged.
- **Legal:** a "Donations" section in `/terms` (voluntary, non-refundable, nothing in return, tax) and in `/privacy`
  (not tracked; the chain is public). Both effective dates are updated.
- **Anti-swap in verify-build** (`scripts/donation-check.mjs`):
  - `/support` must show the configured address and no other 0x40-hex address;
  - every `data-donation-address` and every `ethereum:` URI in any built HTML/JS must match the configured address;
  - the QR code and the wallet link must be present;
  - no shipped JS may call an injected wallet.

## Capabilities

### New Capabilities
- `donation`: the donation address source, the `/support` page, the coffee button and links, and the anti-swap
  guarantees.

## Impact

- **New files:**
  - `config/donation.json`;
  - `apps/web/support/index.html` and `src/support/*`;
  - `vite-plugins/donation.ts`, `scripts/donation-check.mjs`;
  - `src/landing/coffee.ts`.
- **Changed:**
  - footers (`legal/partials/footer.html`, `index.html`, `src/ui/chrome.tsx`), `src/ui/chrome.css`;
  - `src/landing/{boot,main}.ts`;
  - `vite.config.ts`, the legal plugin rewrite, `deploy/gen-context.mjs`, `scripts/verify-build.mjs`;
  - `legal/terms.md`, `legal/privacy.md`, `README.md`;
  - the deploy smoke test and its fixture, and the CI path filter.
- **Dependencies:** devDependencies only, `qrcode-generator@2.0.4` (MIT) and `jsqr@1.4.0` (Apache-2.0, tests only).
  No runtime dependency.
- **Bundle:**
  - landing initial JS 2.79 KB (was 2.65 KB), plus a 3.1 KB lazy chunk;
  - `/app` initial JS is unchanged apart from the footer link markup.

# Proposal

## Why

https://cryoshield.app opens straight into the vault app. Nothing on the site explains what CryoShield is, why it
is safe, or what its limits are (testnet, unaudited, losing every key loses the vault). The founder has also adopted a
visual language (`docs/design/visual-language.md`) that the current ad-hoc app styling does not follow, and the guide
leaves error, validation and key-ceremony states undefined. Both are needed before inviting testers.

## What Changes

- **New landing page at `/`.** A scroll-driven page in the guide's tile grammar: a slim black global nav, a frosted
  sub-nav with a persistent "Open the app" pill, alternating light/dark full-bleed tiles, each with a headline, a
  tagline, two pill CTAs and a motion graphic, then an FAQ and a parchment footer. The copy is honest: testnet
  (OP Sepolia), unaudited, and losing ALL keys loses the vault. It makes no claim the code does not back up.
- **Motion graphics** use **Motion** (`motion`, MIT), pinned in `package.json` and bundled at build time. Only the
  WAAPI-based `motion/mini` animate, `scroll` and `inView` are used. The graphics themselves are first-party inline
  SVG. No Lottie and no downloaded animation assets (see design D3). Motion is lazy-loaded below the fold and never
  loaded at all under `prefers-reduced-motion: reduce`, which gets a static, fully informative page.
- **A JS budget, enforced by `verify-build`:**
  - the landing page's initial JS is ≤ 6 KB gzip;
  - the lazy motion chunk is ≤ 10 KB gzip;
  - the landing page's whole JS graph is ≤ 16 KB gzip;
  - the landing page never loads React, viem, or any vault code.
- **BREAKING (URL): the app moves to `/app/`.** `/app` redirects to `/app/`. The vault does not depend on the path:
  the WebAuthn RP ID stays the domain `cryoshield.app`, so existing vaults and credentials are unaffected. Every page
  is served with the same security headers, and both HTML pages carry an identical CSP.
- **App restyle.** The vault flows get:
  - the guide's tokens as CSS custom properties;
  - the global nav and a sub-nav;
  - pill buttons with a `scale(0.95)` press;
  - 17px body text;
  - utility cards;
  - a floating sticky action bar.

  It also fills the guide's gaps: error, validation and empty states, key-ceremony states ("touch your key", "wrong
  key", "PIN needed", "key not supported"), and a dark theme. It defines one functional error ink.
- **Fonts:** the system stack first, then a self-hosted Inter variable font (woff2, latin subset, SIL OFL 1.1).
- **`docs/design/ASSETS.md`** records every third-party library, font and asset with its source and license.
- **Hosting:** the Caddy config serves `/`, `/app/` and `/app/index.html` (no-cache), redirects `/app` to `/app/`,
  and still returns 404 for everything else. The deploy and container tests cover the new routes.

**Out of scope:**
- any change to crypto, the vault format, contracts, the paymaster, the sponsorship policy, WebAuthn options, UV
  handling, zeroization, the idle wipe, the chain guard, or clipboard clearing (all must stay byte-for-byte equivalent
  in behaviour);
- new product features (health check reminders, Shamir UI, inheritance);
- analytics, A/B testing, cookie banners, or newsletter sign-up;
- localisation;
- IPFS/ENS pinning;
- actually deploying to Fly (the overwatcher deploys after review).

**Runtime dependencies:** one new bundled npm library (`motion`, MIT) and one self-hosted font (Inter, OFL). Both ship
inside the static build from `'self'`. There are no new network origins, no runtime CDN, and nothing operated by
CryoShield. This is not a CryoShield-operated backend.

## Capabilities

### New Capabilities
- `landing-page`: the public explainer at `/`. Covers content and honesty rules, the tile structure, motion and
  reduced motion, the performance budget, and the route split between the landing page (`/`) and the app (`/app/`)
  under the unchanged security headers.
- `app-visual-design`: the vault app's visual system. Covers design tokens, navigation, buttons, cards, the sticky
  action bar, error/validation/empty and key-ceremony states, the error ink, the theme, fonts, and the WCAG 2.2 AA
  contrast, focus and target-size rules.

### Modified Capabilities
None. The vault app's behaviour requirements (in the in-flight `add-web-app` change) and the hosting requirements (in
`add-fly-hosting`) are not archived into `openspec/specs/` yet. This change adds its requirements as new
capabilities and leaves their behaviour unchanged. The new `/app/` path is specified in `landing-page`.

## Impact

- **Code:** in `apps/web`:
  - `index.html` (now the landing page) and a new `app/index.html`;
  - `src/landing/*` (new);
  - `src/ui/*` (markup classes and new presentational components only);
  - `src/ui/global.css` (rewritten);
  - `vite.config.ts` (multi-page input);
  - `scripts/verify-build.mjs` (every HTML page, plus the JS budget);
  - `deploy/gen-context.mjs` (routes, plus identical CSP across pages);
  - E2E fixtures and specs (the new routes).
- **Dependencies:** `motion@13.5.0` (MIT). The Inter woff2 is vendored from `@fontsource-variable/inter@5.3.0` (OFL-1.1).
- **Users:** a bookmark of `https://cryoshield.app/` now lands on the explainer, which has an "Open the app" pill in the
  nav, the hero, and every tile.
- **Docs:** `docs/design/ASSETS.md` (new), `apps/web/deploy/README.md` (routes), and screenshots in
  `apps/web/docs/screenshots/`.

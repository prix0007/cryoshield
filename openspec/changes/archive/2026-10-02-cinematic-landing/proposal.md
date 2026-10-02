# Proposal

## Why

The founder reviewed the live landing page. Two problems came out of it:

- **A visible bug:** a global hover underline appears under the logo, the nav links, and even the text inside pill
  buttons (on `/` and `/app/`). The founder calls it "a weird line under text".
- **The page is too quiet.** The founder asked for a "larger than life" landing page, with cinematic, scroll-driven
  storytelling that makes the case for permanent, key-only backups. It must stay honest (testnet, unaudited, losing every
  key loses the vault) and stay within the visual language.

## What Changes

- **Hover fix.** Pills, buttons, the logo and nav links never underline. Nav and logo links get a subtle opacity change
  on hover instead. Inline links in body copy are always underlined, not only on hover. The fix lives in the shared
  chrome stylesheet, so it applies to `/` and `/app/`.
- **A cinematic landing page:**
  - **Hero:** huge kinetic typography. A security key drifts in, docks, and pulses as it is "tapped". This is CSS only:
    no JS and no LCP cost.
  - **Six pinned scroll scenes**, each a sticky stage scrubbed by scroll progress:
    - fragile media decaying over a 2026 → 2036 counter;
    - the tap: a beam, plaintext scrambling into ciphertext, a vault door sealing;
    - the sealed blob joining a chain of blocks, with a copy streaming to an Arweave archive layer;
    - one key shattering while the other still opens the vault;
    - the website fading out while the recovery tool still opens the vault;
    - a permanence timeline from 2026 to 2126 (with the chain/Arweave caveat).
  - **Polish:** a band of big numbers counting up, parallax depth, magnetic CTAs, and a final full-viewport CTA.
- **Restraint:** one blue accent and light/dark tiles. "Product light" glows and beams use the accent. There are no
  decorative gradients.
- **Honest copy:** the disclosures stay in visible text. Permanence is stated with its dependency on the chain and
  Arweave copies, never as a guarantee.
- **Motion:**
  - The libraries are Motion (already pinned) plus first-party code. No WebGL, which isn't needed for these scenes (see
    design D2). Scene code is split per scene and lazy-loaded.
  - Under `prefers-reduced-motion`, each scene shows a static key frame and the full story stays readable.
  - On mobile, scenes are simplified with shorter pins, and nothing captures the scroll.
- **Budget raised:**
  - landing initial JS ≤ 15 KB gzip;
  - each lazy chunk ≤ 40 KB gzip;
  - the whole landing graph ≤ 120 KB gzip.

  `/app/` stays free of all landing code, which verify-build already asserts.
- **Performance targets:** CLS 0 and LCP < 2.5 s under Lighthouse with Fast 3G-class throttling. The measured numbers
  are recorded in `apps/web/docs/lighthouse-landing.md`.

**Out of scope:**
- any change to vault behaviour, crypto, contracts, the paymaster, the CSP, the security headers, or routing;
- WebGL and three.js;
- new product claims.

**Runtime dependencies:** none new. Motion was already bundled. There are no new origins and nothing operated by
CryoShield. This is not a CryoShield-operated backend.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `landing-page`:
  - the story structure becomes a hero, a numbers band, six pinned scenes, a "Free to use" tile, a final CTA, the FAQ
    and the footer;
  - the reduced-motion requirement covers scenes;
  - the performance budget is raised and adds CLS/LCP targets;
  - adds a scroll-scene requirement.
- `app-visual-design`: adds a link-decoration requirement covering both pages (no underline on pills, buttons, nav or
  logo; inline body links always underlined).

## Impact

- **Code:** in `apps/web`:
  - `index.html`;
  - `src/landing/*` (a new `scenes/` folder);
  - `src/landing/landing.css`;
  - `src/ui/chrome.css` and `src/ui/global.css` (link decoration);
  - `scripts/verify-build.mjs` (budgets).
- **Tests:**
  - unit (content, hover CSS rules, scene progress math);
  - E2E (scenes at scroll positions, reduced motion, keyboard, axe, hover decoration on `/` and `/app/`);
  - Lighthouse record.
- **Docs:** screenshots of the scene stills in `apps/web/docs/screenshots/`.

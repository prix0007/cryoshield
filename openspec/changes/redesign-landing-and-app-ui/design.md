# Design

## Context

- `apps/web` is a single Vite page (`index.html` → `src/main.tsx` → React `App`) served as static files by Caddy on
  Fly (`deploy/gen-context.mjs` generates the Caddyfile). It has no client-side routes and no SPA fallback.
- The CSP is injected into every built HTML page by `vite-plugins/cryoshield.ts`:
  - `script-src 'self'`, `style-src 'self'`, `font-src 'self'`;
  - Trusted Types `'none'`;
  - no `unsafe-*`.

  The Caddy CSP header is derived from `dist/index.html`. `verify-build` checks reproducibility and the CSP of
  `dist/index.html`.
- React's `style={{…}}` props and Motion's style writes go through the CSSOM. CSP `style-src` does not govern the
  CSSOM; it only blocks `style=""` attributes in markup and `<style>` elements. `injectCsp` already refuses either in
  HTML.
- The RP ID comes from `VITE_RP_ID` and is checked against `location.hostname` (`rpIdAllowed`). Nothing in the app
  reads `location.pathname`.
- The founder's guide (`docs/design/visual-language.md`) is binding. Its HEADER RULES allow pinned, bundled motion
  libraries and self-hosted assets with recorded licenses. They forbid eval, `innerHTML` and WASM, and require the
  system font stack first, then self-hosted Inter.

## Goals / Non-Goals

**Goals:**
- A landing page that loads fast and works with no JavaScript, with no motion, and on a phone.
- An app restyle confined to markup classes, presentational components and CSS. The flows' logic and messages are
  untouched.
- Budgets and policies enforced by tests (verify-build, unit, E2E, container), not by convention.

**Non-Goals:**
- A component library or a CSS framework (Tailwind etc.).
- Theming the landing page for dark mode. Its tiles are explicitly light or dark by design.
- Changing any vault string covered by the existing jargon test (`S`). Landing copy lives in HTML.

## Decisions

### D1. Routing: a two-page Vite build, `/` = landing and `/app/` = app
- **How:** `vite.config.ts` gets `build.rollupOptions.input = { landing: index.html, app: app/index.html }`.
  - Caddy's `file_server` already serves `app/index.html` for `/app/`.
  - For `/app` it issues its canonical trailing-slash redirect, which is relative and therefore same-host.
  - Unknown paths stay 404, with no SPA fallback.
- **Rejected alternatives:**
  - *Hash routing in one page* would load React and viem on the explainer and break the budget.
  - *A separate origin such as `www.`* would isolate the landing page's scripts from the vault. However:
    - the deploy guard and the canonical-host redirect assume a single host;
    - the RP ID must stay `cryoshield.app`, and the app must live on that exact host;
    - it would add a second certificate and DNS surface.

    It is recorded as a future hardening option (see Risks).
- **Old bookmarks:** they now land on the explainer, which has an "Open the app" pill in the sub-nav, the hero and
  every tile. Credentials are bound to the RP ID (domain), not the path, so nothing breaks.

### D2. The landing page is static HTML plus a tiny vanilla-TS entry (no React)
- **Markup:** all copy is in `index.html`, so LCP is the hero `<h1>` text and needs no JS.
- **Entry:** `src/landing/main.ts` (≤ 6 KB gzip) does three things:
  - wires the narrow-width nav disclosure (a native `<details>`, so no JS is needed for the basics);
  - sets the footer year;
  - lazy-loads motion.
- **Motion loading:** `src/landing/motion.ts` is imported with `import()` only when:
  - `matchMedia('(prefers-reduced-motion: reduce)')` is false; **and**
  - an `IntersectionObserver` (rootMargin 200px) sees a story graphic.
- **Hero:** the hero graphic animates with CSS keyframes only (in the external stylesheet, disabled under reduced
  motion), so the above-the-fold motion costs 0 bytes of JS.

### D3. Motion library: `motion@13.5.0` (MIT), WAAPI subset only
- **What we use:** `animate` from `motion/mini` (WAAPI, about 2.5 KB), plus `scroll` and `inView` from `motion`.
- **Measured size:** about 6.7 KB gzip, measured with esbuild on 2026-10-02.
- **CSP check:** a grep of the `motion`, `motion-dom`, `motion-utils` and `framer-motion` ESM dists finds no
  `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval(`, `new Function` or `WebAssembly`. Style writes go
  through the CSSOM, which `style-src 'self'` allows.
- **Alternatives:**
  - *GSAP 3.15* is rejected. Its "Standard no-charge" license is not OSI-approved, while CryoShield is MIT and fully
    open source.
  - *lottie-web* is rejected:
    - the full build evaluates expressions with `eval`/`new Function`;
    - the light build still needs third-party JSON animations of mixed provenance;
    - the dotLottie player needs WASM (`'wasm-unsafe-eval'`).
  - *Hand-rolled WAAPI* was viable, but Motion's `scroll()` gives ScrollTimeline-backed, scroll-linked progress with
    a tested fallback, at about 4 KB.
- **Graphics:** first-party inline SVG in `index.html`, drawn for CryoShield. No downloaded animation assets, so
  `ASSETS.md` lists only Motion and Inter.

### D4. Performance budget (enforced in `scripts/verify-build.mjs`)
- **Measurement:** verify-build parses `dist/index.html` for its entry `<script src>`. It then walks the static
  `import … from "./x.js"` edges and the dynamic `import("./x.js")` edges of the emitted chunks, and gzips each file
  (zlib level 9).
- **Budgets:**
  - landing initial (entry + static imports) ≤ **6 KB** gzip;
  - every lazily loaded landing chunk ≤ **10 KB** gzip;
  - the whole landing graph ≤ **16 KB** gzip;
  - the landing graph contains no React, viem or vault-crypto marker strings.
- **On failure:** the build fails, and the measured numbers are printed.
- **Images and fonts:** there are no raster images. The Inter woff2 (about 48 KB, latin subset, variable weight) is
  only fetched when no system UI font is available, because `system-ui` comes first.

### D5. Fonts
- **Stack:** `system-ui, -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif`.
- **Inter:** one `@font-face` for "Inter" points at `src/ui/fonts/inter-latin-wght-normal.woff2`. The file is
  vendored byte-for-byte from `@fontsource-variable/inter@5.3.0` (SIL OFL 1.1, Copyright the Inter Project Authors).
  Its SHA-256 and the OFL text are recorded in `docs/design/ASSETS.md` and `src/ui/fonts/OFL.txt`.
- **Loading:** `font-display: swap`. Vite emits the file under `/assets/` with a content hash (same-origin, immutable).
- **Inter adjustments (deviation):** the guide's Inter-only tweaks (`"ss03"`, an extra -0.01em of display tracking)
  are not applied, because CSS cannot detect which family in the stack actually rendered. The difference is cosmetic.

### D6. Tokens, error ink and contrast decisions
- **Tokens:** they live in `src/ui/tokens.css`, are imported by both pages, and copy the guide's values.
- **Deviations required by WCAG 2.2 AA** (unit-tested in `test/ui/tokens.test.ts`):
  - `--ink-muted-48` is `#6e6e73`, not `#7a7a7a`. The guide's value is 4.29:1 on white, below 4.5:1; ours is 5.07:1
    on white and 4.66:1 on parchment.
  - Text-input borders are `--input-border #86868b` (3.62:1 on white), not `rgba(0,0,0,.08)` (about 1.2:1). WCAG
    1.4.11 requires 3:1 for the boundary of a control.
  - The focus ring is `#0071e3` on light surfaces (4.70:1 on white) and `#2997ff` on dark surfaces (4.94:1 on
    #272729). The guide's `#0071e3` is only 3.17:1 on tile-1, a thin margin, so dark surfaces use Sky Link Blue,
    which the guide already reserves for dark.
- **Error ink:** `--error-ink #c4161c` on light surfaces (6.04:1 on white, 5.54:1 on parchment) and `#ff6961` on dark
  surfaces (5.29:1 on #272729, 7.45:1 on black). Why:
  - the guide forbids a second *accent*, and the error ink is never used on an interactive element, so the accent
    stays unique;
  - red is the near-universal convention for "something went wrong", which matters most mid key ceremony;
  - it is never the only signal (WCAG 1.4.1), because every error also has an icon, a text title and `role="alert"`;
  - the chosen reds clear 4.5:1 for body-size text in both themes with margin, unlike brighter reds (for example
    #ff3b30 is 3.55:1 on white).
- **Success and info:** these use no new hue. Success is ink text on parchment with a check glyph; info is ink on
  parchment. This keeps "no new colours except a functional error ink".
- **App dark theme:** this fills a gap in the guide. The tokens are:
  - canvas `#000`;
  - card `#1d1d1f` with hairline `#424245`;
  - ink `#f5f5f7` and muted `#a1a1a6`;
  - links `#2997ff`;
  - primary pills keep Action Blue `#0066cc` with white text (5.57:1).

  It switches on `prefers-color-scheme: dark`, as today.

### D7. Components (presentational only)
- **`GlobalNav` and `SubNav`** (React for the app, static HTML for the landing page):
  - The narrow menu is a native `<details>/<summary>` with a 44px summary.
  - The sub-nav in the app shows the surface name and a "Testnet" chip. There is deliberately no primary CTA there,
    because duplicating "Lock" or "Unlock my vault" would give two buttons the same name. This is a recorded
    deviation from the guide's persistent sub-nav CTA. On the landing page, the sub-nav CTA is "Open the app".
- **`ActionBar`:** this wraps a step's existing `.actions` buttons in a `position: sticky; bottom: 0` floating bar
  (parchment at 80% with blur, pill radius, 64px). Because it stays in DOM order, Tab order is unchanged.
  `html { scroll-padding-bottom: 96px }` keeps focused fields clear of the bar (WCAG 2.4.11).
- **`Notice`:** gains an icon and an optional title. The title comes from `noticeTitle(message)`, a pure lookup from
  an existing message string to its ceremony state. This means:
  - flows still call `setError(messageFor(e))` unchanged;
  - the mapping is: WRONG_KEY / DUPLICATE_KEY / not-in-vault → "Wrong key"; USER_NOT_VERIFIED → "PIN needed";
    PRF_UNSUPPORTED_KEY / WRONG_ALGORITHM / PRF_UNSUPPORTED_BROWSER → "Key not supported"; CANCELLED → "Request
    cancelled"; anything else → "Something went wrong".
- **`KeyPrompt`:** becomes the ceremony panel. It has:
  - a "Touch your key" state label;
  - an SVG key glyph (replacing the emoji, which rendered inconsistently and was announced by some screen readers);
  - a CSS pulse ring that is off under reduced motion.

  It keeps `role="status"` and the existing text and Continue button. No JS animation runs in the app, so nothing
  can delay `navigator.credentials.*`.
- **`EmptyState`:** shown when an unlocked vault has zero items.
- **Validation:** `SecretsEditor` marks secret fields `aria-invalid` and `aria-describedby` the meter when over
  capacity. The meter already uses the error ink.

### D8. Build and deploy plumbing
- **`verify-build`:** it checks every `dist/**/*.html` for the CSP meta tag (all identical) and no inline
  script/style, and adds the D4 budget.
- **`gen-context.mjs`:**
  - it requires every HTML page's meta CSP to be identical, and refuses otherwise;
  - it derives the header CSP from it;
  - it marks `/`, `/index.html`, `/app/` and `/app/index.html` `no-cache`.
- **`release-manifest.mjs`:** this still reads the CSP from `index.html`, which is identical to `app/index.html` by
  the check above.
- **Tests:** the container test adds:
  - `/app/` → 200 with headers;
  - `/app` → redirect to `/app/`;
  - `/app/index.html` → no-cache;
  - `/app/nope` → 404.
- **E2E fixtures:** these navigate to `/app/`.

## Threat / abuse considerations

The change touches no crypto, contract or paymaster code. It does change what runs on the vault's origin.

- **[Supply chain on the same origin]** The landing page now runs third-party code (Motion) on `https://cryoshield.app`,
  the same origin as the vault. A malicious Motion release could `window.open('/app/')` and script that same-origin
  window. Mitigations:
  - Motion is pinned to an exact version with the lockfile integrity hash (pnpm `--frozen-lockfile` in CI), and install
    scripts are disabled repo-wide.
  - Only three functions are imported; tree-shaking leaves about 4–7 KB that can be reviewed.
  - It is never loaded on `/app/`.
  - Builds are reproducible, and the release manifest lets anyone diff the deployed bytes.
  - The CSP still forbids eval, inline scripts, `innerHTML`/TT sinks and other origins, so an injected payload cannot
    fetch a second stage from elsewhere or exfiltrate to an unlisted origin.
  - Residual risk is accepted and comparable to the existing React/viem dependencies. The future hardening option is
    to serve the explainer from a separate origin (D1).
- **[CSP drift between pages]** Two HTML pages could diverge. verify-build and gen-context refuse non-identical CSPs.
- **[Phishing look-alike]** The landing page links only to `/app/` and to `github.com/prix0007/cryoshield`. External
  links carry `rel="noopener noreferrer"`, and none opens a new window.
- **[Clickjacking]** This is unchanged: `frame-ancestors 'none'` and `X-Frame-Options: DENY` apply to every response.
- **[Ceremony interference]** The app has no JS motion. The CSS pulse is decorative, `aria-hidden` and off under
  reduced motion, and never overlays the browser's WebAuthn dialog.
- **[Misleading copy]** A unit test enforces the honest-copy requirements: the required disclosures are present and a
  denylist of overclaims is absent.

## Risks / Trade-offs

- **[Breaking URL]** Users who bookmarked `/` expecting the app get the explainer → there are prominent "Open the app"
  pills, and vault access is path-independent.
- **[Motion's ScrollTimeline fallback uses rAF]** On browsers without ScrollTimeline, scroll-linked progress runs on
  rAF → it is applied only to the one "How it works" diagram and degrades to the static diagram on failure (any import
  or runtime error is caught, and the page stays static).
- **[System font differences]** Headlines look slightly different across OSes → this is accepted; the guide mandates
  the system stack first.
- **[Sticky bar on short viewports]** It eats vertical space → it is 64px, and on viewports below 500px tall it
  becomes static (in-flow).
- **[Repo URL assumption]** The footer links to `https://github.com/prix0007/cryoshield` (the `origin` remote) →
  **assumption**: the repository is or will be public (the PRD requires it), and the recovery-tool docs live at
  `tools/recover/README.md` on `main`.

## Migration Plan

1. Merge; the overwatcher runs `deploy.sh` (unchanged flow). The release manifest lists both pages.
2. Post-deploy, check that `curl -I https://cryoshield.app/` and `https://cryoshield.app/app/` show identical security
   headers, and that `/app` redirects.
3. Rollback: redeploy the previous commit (`fly deploy` of the prior image). No data migration is involved; vaults are
   on-chain and keyed by RP ID.

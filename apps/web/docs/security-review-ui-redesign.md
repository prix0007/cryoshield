# Security review: redesign-landing-and-app-ui

- **Date:** 2026-10-02
- **Reviewer:** frontend-engineer (self-review; an independent review by the overwatcher is still recommended)
- **Scope:**
  - landing page (`index.html`, `src/landing/*`);
  - route split (`app/index.html`, `vite.config.ts`);
  - `motion@13.5.0`;
  - vendored Inter;
  - `scripts/verify-build.mjs`;
  - `deploy/gen-context.mjs`;
  - the presentational changes in `src/ui/*`.

**Verdict: APPROVED. No CRITICAL or HIGH findings.**

## Checks

| # | Check | Evidence | Result |
|---|---|---|---|
| 1 | CSP is unchanged and identical on both pages | `buildCsp` untouched. `verify-build` requires exactly one byte-identical meta CSP in `index.html` and `app/index.html` (no `unsafe-*`, no `wasm-unsafe-eval`, TT `'none'`). `gen-context.mjs` refuses differing CSPs (`deploy/test/gen-context.test.ts`). The container test asserts that `/` and `/app/` send the same CSP header. | Pass |
| 2 | No eval / innerHTML / WASM / TT sinks | A grep of the built `landing-*.js`, `motion-*.js` and `preload-helper-*.js` for `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(`, `new Function`, `WebAssembly` finds no matches. E2E `05-landing` runs every animation under the real CSP and records zero CSP/TT console messages and zero page errors. Injected inline script and `insertAdjacentHTML` are blocked on the landing page. | Pass |
| 3 | No new origins | The landing JS contains no URLs. The 20-security network allowlist test is unchanged and green. Fonts are served from `/assets/` (`font-src 'self'`). External `<a>` links point only to `github.com/prix0007/cryoshield`; they are navigations, not fetches. | Pass |
| 4 | Landing page loads no vault code | `verify-build` walks the landing JS graph (static + dynamic imports) and fails on React, viem or vault markers. `test/build/pages.test.ts` checks the same on a real build. | Pass |
| 5 | Supply chain (Motion) | Exact pin `13.5.0`, lockfile integrity, install scripts disabled repo-wide. Only `animate` (`motion/mini`), `scroll` and `inView` are imported: 6.86 KB gzip, lazy, and never on `/app/`. Recorded in `docs/design/ASSETS.md`. Residual same-origin risk is accepted (design.md, Threat section); the hardening option is a separate origin for the explainer. | Pass (accepted residual) |
| 6 | Vault invariants (UV, zeroization, idle wipe, auto-lock, chain guard, clipboard clearing, PRF) | `git diff 44f054f -- src/webauthn src/account src/chain src/vault src/mirror src/ui/useAutoLock.ts src/ui/clipboard.ts src/ui/operations.ts` is empty. Flow diffs are markup only (class names, `ActionBar`, `EmptyState`). The existing unit (`session`, `flows`, `guards`), integration and E2E (`10-flows`, `20-security`, `40-errors`) suites pass unchanged except for the route. | Pass |
| 7 | Path independence / RP ID | The app reads only `location.hostname`. The `rpId` in the bundle is still the domain (the container test `rpId:"cryoshield.app"`). `/app` → `/app/` is a relative same-host redirect, and the container test asserts the host. | Pass |
| 8 | Routing / exposure | No SPA fallback: `/app/does-not-exist`, `/landing` and `/app/_headers` return 404 with headers. `_headers` is still stripped from the image. | Pass |
| 9 | External links / phishing | No `target=_blank`. Every external link is `rel="noopener noreferrer"` and points to the project repository (unit test). There are no third-party marks except the factual "YubiKey is a trademark of Yubico." | Pass |
| 10 | Honest copy | `test/landing/content.test.ts` requires the testnet, not-audited and all-keys-lost statements outside collapsibles. It denylists overclaims (audited, mainnet, military-grade, quantum-proof, L1 anchor, IPFS/ENS, guarantee). A claim found during review ("relies on WebCrypto") was corrected to "@noble libraries", which is what `vault-crypto` uses. | Pass |
| 11 | Ceremony interference | The app has no JS motion. The key pulse is CSS only, `aria-hidden`, and off under reduced motion. `useFocusClearOfActionBar` only scrolls the window on `focusin`; it never touches `navigator.credentials` or the flow state. | Pass |

## Findings

- **LOW-1 (accepted):** `preload-helper` is a small Vite runtime chunk shared by both pages. It queries
  `meta[property=csp-nonce]` and creates `<link rel=modulepreload>` elements. No TT sink is involved, and the landing
  page passes an empty deps list.
- **LOW-2 (accepted, documented):** third-party code (Motion) now runs on the vault's origin, on `/` only. See the
  design threat model.

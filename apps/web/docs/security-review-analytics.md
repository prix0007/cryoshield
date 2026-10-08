# Security review: add-privacy-preserving-analytics (P1, landing beacon)

- **Date:** 2026-10-03
- **Reviewer:** frontend-engineer (self-review for task 6.1; security-reviewer sign-off on the beacon bytes still
  recommended)

**Verdict: APPROVED. One finding (MEDIUM) was fixed during review. No open CRITICAL or HIGH findings.**

| # | Area | Evidence | Result |
|---|---|---|---|
| 1 | Reviewed beacon bytes | `beacon.min.js` 2026.9.1 (30,294 bytes, `sha384-rZU/…S8x0M`):<br>- no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(`, `new Function`, `WebAssembly`, `createElement` or `setAttribute`;<br>- no cookie, localStorage, sessionStorage or IndexedDB access;<br>- reports via `sendBeacon`/XHR to `https://cloudflareinsights.com/cdn-cgi/rum`;<br>- history hooks only when `spa` is true (we set `spa:false`);<br>- the response sets no cookie; `ACAO: *`, so SRI with `crossorigin="anonymous"` works.<br>Details are in `analytics/beacon.lock.json`. | Pass |
| 2 | Pinning | The integrity value comes only from the lock (unit test + verify-build on a production build with a token). A tampered file is refused (E2E): no report, the page works. The weekly drift job is read-only, has no secrets and uses SHA-pinned actions (zizmor pedantic: no findings; workflow policy OK). | Pass |
| 3 | Trusted Types | Unchanged (`'none'`). The loader never sets `script.src`: it clones a build-time `<template>` with `importNode`. No TT or CSP violation in E2E with the beacon running. | Pass |
| 4 | Gating | GPC, DNT or a foreign host → no element and zero Cloudflare requests (unit + E2E). Query and fragment are stripped with `replaceState` before insertion (unit order check). The E2E report bodies and URLs contain no `abc`, `utm_source` or `frag`. | Pass |
| 5 | Confinement | The app and legal HTML, plus every JS file reachable from them, contain no `cloudflareinsights`, `beacon.min.js`, `cf-beacon` or token (verify-build). `/app/` create, unlock and update make zero Cloudflare requests, including after navigating from the landing page (E2E). The token is never in the virtual config, so it can't reach the app bundle. | Pass |
| 6 | Per-route CSP | The landing CSP = app CSP + the exact beacon URL (script-src) + `https://cloudflareinsights.com` (connect-src). `gen-context` and verify-build refuse any other difference. Caddy picks the CSP by the **raw** path (`/`, `/index.html` only). `/app`, `/app/`, `/app/index.html`, the legal pages, `//`, `/App/`, `/%2F`, unknown paths and 404s get the app CSP (container tests). | Pass |
| 7 | WebAuthn on the landing document | The landing Permissions-Policy has `publickey-credentials-get=()` and `create=()`. E2E: `navigator.credentials.get` on `/` rejects with a Permissions-Policy `NotAllowedError`, and `featurePolicy` is false on `/` but true on `/app/`. | Pass |
| 8 | Opener guard | The app renders "Open CryoShield directly" and creates no services when `window.opener` is set. E2E: `window.open('/app/')` from `/` → no WebAuthn call and no RPC, bundler or Arweave request. The way out is a `target=_blank rel=noopener` link (a fresh tab no other page can script). | Pass |

## Findings

- **MEDIUM-1 (fixed):** `//` (and other non-canonical paths that normalise to `/`) served the landing document with
  the app Permissions-Policy, so WebAuthn was allowed there. The beacon could not load (the app CSP header blocks
  it), but the landing-only Permissions-Policy guarantee did not hold. Fix: the Permissions-Policy now follows the
  **normalised** path (`@landingdoc path / /index.html`), while the CSP follows the raw path. Container test added.
- **LOW-1 (accepted, design D4):** the same-origin residual risk remains: a compromised but integrity-matching
  Cloudflare release is impossible by construction, and a malicious lock bump would need a reviewed PR. Moving the
  landing page to its own origin remains the founder's option.
- **OPEN (founder, task 3.2):** whether Cloudflare permits self-hosting (D4a). The shipped path is D4b (Cloudflare-hosted
  + SRI), which fails closed on updates.

## Beacon re-reviews

- **2026-10-08, 2026.10.0** (31,679 bytes, `sha384-IJ+SAO…kahIq+`), diffed against 2026.9.1 (Wayback capture,
  byte-identical to the previous pin). **Pass.** There are no new sinks, storage, endpoints, fingerprinting APIs or
  payload fields, and the query, fragment and userinfo are still stripped. Changes:
  - a flat bundle instead of webpack modules;
  - guarded polyfills for `includes`, `globalThis` and `queueMicrotask`;
  - finer browser and OS version parsing from the user agent;
  - a pre-existing `window.__cfBeacon` now overrides `data-cf-beacon`. This has no effect here: we never set it, and
    CSP blocks inline script and other endpoints.

  Details are in `analytics/beacon.lock.json`. Human security-reviewer sign-off is still pending.

# Design: refuse writes from an outdated app build

## Context

The app is a static multi-page Vite build (`/app/` is the vault app). Every JavaScript file is content-hashed and served
`immutable`; the HTML pages are served `no-cache`, so a reload always revalidates and runs the current build. Deploys
replace the whole site, so an old tab's lazy chunks 404 afterwards. `/release.json` (`no-store`) names the live commit
and tree hash, but the bundle does not know its own commit or tree hash.

## Goals / Non-Goals

**Goals:** an open tab never writes a vault with code older than what the site serves, when that can be known; the user
learns about an update before entering secrets where cheap; a missing chunk always offers a one-tap reload.

**Non-Goals:** forcing a reload; preserving an unsaved draft across a reload; detecting CSS-only or HTML-only changes
(they cannot change what is written); closing the seconds-long race between the check and the signature (D2).

## Decisions

### D1 — Identity: the running document's module entry scripts

The build identity is the set of `<script type="module" src>` paths in the page. The running side reads them from
`document` (`querySelectorAll`); the live side fetches the same page path and extracts them from the HTML text.

- Rollup/rolldown content hashes cascade through static and dynamic imports, so any change to JavaScript the page can
  load renames the entry. Verified on this repo: a one-string change confined to the lazy `VaultLocation` chunk renamed
  `app-b4zEcrGt.js` → `app-CgKgEW0g.js`, a change in `@cryoshield/vault-crypto` renamed it too, and an unchanged tree
  rebuilt to the same name.
- It compares exactly what a reload would run, with no build change. Vite's runtime-injected `<link>` tags for lazy CSS
  and `modulepreload` are not compared (they exist only in the running document).
- Paths are normalised with `new URL(src, location.href).pathname` and compared as sorted sets.
- The fetched HTML is parsed with a strict regex over `<script …>` tags, not `DOMParser`: the CSP requires Trusted Types
  and `parseFromString` is a Trusted Types sink. The regex only reads attribute values; nothing is inserted into the DOM.

Rejected:
- **Embed the commit with a Vite `define` and compare with `/release.json`.** Every commit (docs included) would change
  every chunk hash, which defeats the deploy pipeline's "tree unchanged" detection and makes rebuild comparison noisier.
- **Embed the tree hash.** Circular: the tree hash covers the bundle.
- **Capture `/release.json` at boot and compare later.** A deploy between the HTML load and the boot fetch makes old
  code look current; the tree hash also changes for HTML-only edits (legal pages), forcing pointless reloads.

### D2 — Where: at the start of every write flow, every time

`saveNewVault`, `rewrite` (edit, rename, archive, Archive and clear all go through it via `vault-meta.ts`) and
`saveAddKey` call `assertCurrentBuild(svc)` first, before `loadWriteStack()` and before any key tap, so an outdated build
never costs a tap. The result is not cached: an old tab that already loaded the write stack (the 2026-10-10 case) is
still checked. A deploy landing between the check and the signature (seconds) is accepted: that write uses the build
that was current a moment ago.

### D3 — Unknown fails open

`checkBuild()` returns `current`, `outdated` or `unknown`. Only `outdated` blocks. `unknown` covers: fetch rejected
(offline), no response within 4 s (aborted), a non-2xx status, a non-HTML content type, or no module script found in
either document (e.g. the dev server's unhashed entry is equal on both sides and counts as `current`).

Why fail open: a backup app that refuses to save because a same-origin page fetch failed hurts users more than the
residual risk. Writes need the network anyway, so a failing check usually precedes a failing write with its own message.
Old code still writes a valid vault (decoders accept every earlier encoder's output, a format rule), so a missed
check costs a weaker-but-valid write, never data loss. An attacker who could make the fetch fail can already block the
write itself. The check is a staleness guard, not an authenticity control: the page is fetched over the same TLS origin
the app already trusts.

### D4 — Outdated: nothing written, explicit reload, draft not preserved

The flow throws `WriteError('OUTDATED')`. The UI shows the error notice ("CryoShield was updated", message
`S.save.outdated`) with a **Reload page** button (`location.reload()`). The draft stays on screen until the user presses
it; the message says unsaved changes are lost on reload. The draft is never written to storage: plaintext must never
touch browser storage (requirement "Secrets in memory only with auto-lock").

### D5 — Passive notice on return to the tab

`App` runs the check on `visibilitychange` to `visible` (and once at start), at most once per 60 s, never on a timer.
On `outdated` it shows an info notice "A new version of CryoShield is available" with **Reload page**, which stays until
the reload. It never blocks anything by itself; D2 still guards the write.

### D6 — Reload where code failed to load

`ChunkBoundary` fallbacks (the vault location panel and the app's chunk-failure notice) and the `LOAD_FAILED` save
error show the same **Reload page** button. The message copy already tells the user a reload may be needed.

### D7 — Privacy, CSP, storage

The check is a same-origin `GET` of the page the user already loaded (`credentials: 'same-origin'`, `cache:
'no-store'`, no query string). `connect-src 'self'` already allows it; the CSP is unchanged. Nothing is stored and
nothing secret is involved. The server sees one extra page request per write and per throttled tab return.

## Risks / Trade-offs

- **False "outdated"** if the server returns a different 200 HTML for the app path (for example a captive portal).
  Saving would not work there anyway; the reload is harmless.
- **The race in D2** remains, by design.
- **Lost draft** on reload, stated in the copy; preserving it would mean storing plaintext.

## Security review

Reviewer: implementing agent, 2026-10-12, against D1–D7 (the PR's automatic ECC review is the independent pass).
Scope: `src/lib/build-check.ts`, `src/ui/useUpdateAvailable.ts`, the three write entry points in `operations.ts`, the
Notice / ChunkBoundary reload buttons, the e2e route.

| # | Check | Evidence | Result |
| --- | --- | --- | --- |
| 1 | Every on-chain write is checked. `createVaultOnChain`, `updateVaultOnChain` and `addKeyOnChain` are called only from `saveNewVault`, `rewrite` and `saveAddKey` (`stack.ts` only re-exports them); name, archive and Archive and clear reach `rewrite` through `vault-meta.ts` | grep of `src/`; `build-check-flows.test.tsx` runs all six paths | Pass |
| 2 | The check runs before `loadWriteStack()` and before any WebAuthn ceremony, on every write (not cached) | unit tests assert no stack load, no `get`/`create`, no `send`; e2e asserts the sign count is unchanged | Pass |
| 3 | The request carries nothing: a fixed same-origin path from `location.pathname`, `GET`, no body, no query, `credentials: 'same-origin'` | unit test on the fetch arguments; e2e asserts an empty query string and no post data | Pass |
| 4 | No storage: nothing is written to any browser store; the draft is never persisted | code read; no storage API in the new files (verify-build storage inventory) | Pass |
| 5 | Parsing cannot inject: the served HTML is read with a linear regex over `<script>` tags, only attribute text is kept, nothing reaches the DOM or a Trusted Types sink; the CSP is unchanged | code read | Pass |
| 6 | Fail-open is exactly D3: a rejected or aborted fetch, a non-2xx or non-HTML answer, no module script, or a throwing check is `unknown` | unit tests | Pass |
| 7 | A create retry after `OUTDATED` cannot use wiped PRF outputs: `saveNewVault` wipes only the copies CreateFlow passes it | `CreateFlow.tsx` passes `k.prf?.slice()` per attempt | Pass |
| 8 | The reload is user-started only (`reloadPage()` is called from one button handler); no automatic reload or loop | grep | Pass |

Residual risks, all LOW and accepted:

- **L1, the D2 race:** a deploy between the check and the signature is not caught; that write uses the build that was
  current seconds before.
- **L2, slow links:** on a connection where the page fetch takes over 4 s the check is `unknown` and the write goes
  ahead (D3). An e2e run on a loaded machine showed exactly this once; the test now serves its page from memory.
- **L3, create after enrollment:** an outdated tab learns of the update at Save, after the keys were enrolled; reloading
  discards that setup and the user enrolls again (a resident credential left on a key uses a slot). The start-up and
  tab-return notice (D5) makes this rare.

No CRITICAL, HIGH or MEDIUM findings.

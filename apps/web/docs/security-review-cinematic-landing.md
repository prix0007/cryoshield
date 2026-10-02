# Security review: cinematic-landing

- **Date:** 2026-10-02
- **Reviewer:** frontend-engineer (self-review; an independent review by the overwatcher is recommended)

**Verdict: APPROVED. No CRITICAL or HIGH findings.**

| # | Check | Evidence | Result |
|---|---|---|---|
| 1 | CSP and headers unchanged | `git diff origin/main -- apps/web/vite-plugins apps/web/deploy` is empty. verify-build still requires one identical strict CSP on both pages. The container suite is unchanged and green (44/44). | Pass |
| 2 | No CSP-hostile sinks in landing code | A new verify-build gate fails if the landing JS graph contains `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(`, `new Function` or `WebAssembly`; it passes. Scene code writes only `textContent`, `classList` and `style.setProperty`. E2E `07-scenes` scrubs every scene with zero CSP/TT console messages or page errors. The injection test on `/` still blocks inline script and `insertAdjacentHTML`. | Pass |
| 3 | No new dependencies or origins | `package.json` and `pnpm-lock.yaml` are unchanged. Lighthouse was run with `npx` and is not a project dependency. Motion `scroll` is the only import. No new URLs appear in the landing JS. The favicon is `data:,`, already allowed by `img-src 'self' data:`, and makes no request. | Pass |
| 4 | `/app/` free of landing code | The verify-build landing-graph walk (React/viem/vault markers) passes, and the app entry imports nothing from `src/landing`. The only change on the app side is the shared `chrome.css` link-decoration fix. | Pass |
| 5 | Honest copy | The unit tests require the testnet, not-audited and all-keys-lost statements outside collapsibles, and the timeline's chain + Arweave + key caveat. They denylist "guaranteed", "forever", "unbreakable", "never lose", "mainnet", "audited by" and others. The numbers band uses checkable figures ("0 copies of your secrets or keys we hold"), not "0 servers": the site is served by a static host. | Pass |
| 6 | Supply chain | Motion stays pinned at 13.5.0 and is recorded in `docs/design/ASSETS.md` (usage updated to `scenes/runtime.ts`). | Pass |
| 7 | Ceremony interference | Scenes exist only on `/`. `/app/` has no new JS. | Pass |

## Findings

- **INFO-1:** the illustrative seed words in the tap scene ("abandon ability…") are BIP39 dictionary words, not a real
  phrase. They appear as `data-plain` attributes and are swapped into SVG `<text>` via `textContent`.

# Design

## D1. Projects

| Project | Device | Runs |
| --- | --- | --- |
| `chromium` | Desktop Chrome | every spec except `09-analytics` and `21-mobile` (unchanged otherwise) |
| `analytics` | Desktop Chrome, port 4174 | `09-analytics` (unchanged) |
| `mobile` | `devices['Pixel 7']` (412×839, DPR 2.625, `isMobile`, `hasTouch`, Android Chrome UA) | the feature specs in D2 and `21-mobile` |
| `mobile-small` | `devices['Pixel 7']` with a 360×740 viewport | `21-mobile` only |

All projects are Chromium: the virtual authenticator with PRF is a CDP feature (`e2e/README.md`), so WebKit iPhone
presets cannot run the vault flows. `isMobile` + `hasTouch` give the coarse pointer, touch events, `tap()` and the
mobile viewport meta handling that a phone has. One worker, as before: the specs share one anvil stack.

`21-mobile` skips itself outside a project with `isMobile` (defence in depth if the project filters change).

## D2. Feature specs re-run under `mobile`

Run (each one exercises a user-visible feature whose layout or input differs on a phone):
`05-landing`, `08-legal`, `10-flows`, `11-architecture`, `14-devices`, `15-support`, `16-seo`, `17-vaults`,
`18-vault-layout`, `19-theme`, `30-a11y`, `40-errors`, `21-mobile`.

Excluded, and why:
- `00-smoke`: probes the virtual authenticator itself, not the UI; viewport-independent.
- `06-hover`: hover styles; a touch phone has no hover.
- `07-scenes`: scroll-pinned desktop scenes; it already has its own phone test ("phone: touch scrolling reaches the
  footer; scenes are unpinned and simplified") built on an `isMobile` context.
- `09-analytics`: its own build and project; the beacon does not depend on the viewport.
- `12-motion`: frame-by-frame animation timing; viewport-independent, and its reveal/copy/disclosure coverage is
  repeated by tap in `21-mobile`.
- `13-credprotect`: WebAuthn extension plumbing; viewport-independent.
- `20-security`: request origins, storage and CSP; viewport-independent.
- `90-screenshots`: documentation screenshots, skipped unless `SCREENSHOTS=1`; they already capture phone shots.

Specs in the run list that resize to a desktop width for one test (for example 1280 px checks in `05-landing`) keep
doing so; on `mobile` they then run with touch at that width, which is harmless.

## D3. The checks in `21-mobile`

A shared `phoneAudit(page, where)` runs on every page and every settled vault screen:

1. **No horizontal scroll:** `documentElement.scrollWidth <= innerWidth`.
2. **Tap check:** every visible interactive element (`a[href]`, `button`, `input`, `select`, `textarea`, `summary`)
   is scrolled into view and checked with `locator.tap({ trial: true })` (Playwright's actionability: visible,
   stable, enabled, and the hit point is not covered, for example by the sticky action bar), and its box must be
   inside the viewport horizontally. Visually hidden elements (`.sr-only`, skip link) are skipped.
3. **Target size:** each target's box (a checkbox's is its wrapping label) is at least 24×24 (WCAG 2.2 2.5.8). The
   inline exception (a link inside a `p`, `li` text or `dd`) and the spacing exception (a 24 px circle on the target
   centre meets no other target) are applied. Targets under 44×44 are recorded as an advisory test annotation, not a
   failure (the 44 px rule for app controls is already enforced by `30-a11y` and `17-vaults`).
4. **No clipped text:** no visible element whose own text overflows a box with `overflow` other than `visible`
   (`scrollWidth > clientWidth + 1`), unless it is a scroll container the user can scroll (`auto`/`scroll`) or
   deliberately truncated with `text-overflow: ellipsis` and its full value is in the accessible name; and no
   visible text element extends past the viewport's right edge outside a horizontal scroll container.
5. **Reachable scroll containers:** an element that scrolls sideways at this width is focusable or contains a
   focusable control (WCAG 2.1.1), so a keyboard or switch user can scroll it too.

Walks:
- **Pages:** `/`, `/app/`, `/privacy`, `/terms`, `/cookies`, `/architecture`, `/devices`, `/support`: audit, open the
  menu by tap (it fits the viewport, every item is tappable, a second tap closes it), choose Dark and back to System
  in the theme switch, tap one footer link to another page, and tap the primary CTA.
- **Landing extras:** every FAQ item opens and closes by tap.
- **Support:** Copy address by tap.
- **Vault flow:** create with two keys (taps only) → saved → open vault → Show → Copy → Where your vault is stored
  → All vaults → back → Details & backup file → Close → Rename or archive → Cancel → Add a key (third key, taps) →
  Lock → unlock with the third key. `phoneAudit` on each settled screen.

## D4. CI time

`test:e2e` already runs all projects in the `web-e2e` job with the Chromium it installs, so no workflow change is
needed. The measured local time is recorded in tasks.md 2.2; the job's 30-minute timeout is kept.

## D5. Defects found and fixed

1. **The narrow-screen menu was painted under the sub-nav (every page with a sub-nav, any width ≤ 833 px).** The
   frosted sub-nav has `backdrop-filter`, which makes it a stacking context painted after the absolutely positioned
   menu list in the global nav. Before: tapping "How it works" in the open menu hit the sub-nav's "Open the app"
   instead (`21-mobile`: "Open the app … intercepts pointer events"). After: `.global-nav { position: relative;
   z-index: 1 }` in `chrome.css`; the menu is on top, every item takes the tap. Desktop is unchanged (the menu is hidden there).
2. **Landing footer "FAQ" link was a 31×44 px target** (advisory under 44, not a 2.5.8 failure). Before: 31 px wide.
   After: `.footer-links a { min-width: var(--target) }` in `landing.css`; 44×44.
3. **The /cookies tables could not be scrolled from the keyboard on a phone** (axe `scrollable-region-focusable`,
   WCAG 2.1.1, in `08-legal`, `15-support` and `19-theme` on `mobile`; `21-mobile` on `mobile-small`). The inventory
   tables scroll sideways inside `.table-wrap` at 360–412 px and contain no focusable element. Before: two
   unreachable scroll regions. After: the legal renderer (`vite-plugins/legal.ts`, also used by /devices) emits every
   wrapper as `<div class="table-wrap" tabindex="0" role="region" aria-labelledby="<section heading id>">` (the two
   generated /cookies tables get an `aria-label`), the pattern /architecture already uses for its figures; the global
   `:focus-visible` ring applies. Unit test: `test/legal/renderer-tables.test.ts`. The landing comparison table is
   not affected (it fits at 360 px).

Advisory, not changed: the four "… privacy" links in the /privacy processor table are 44×37 px. They pass 2.5.8 (≥ 24 px)
and sit one per table row; enlarging them would change the table's density for every reader.

Test tooling, not product defects (fixed in the spec): Chromium still gives content inside a closed `<details>` a
layout box, so the audit uses `checkVisibility()`; a disabled button cannot take a trial tap, so it is checked for
being uncovered instead. The audit was proven to fail on a tiny target, a clipped heading, a covering overlay and a
page-wide element (temporary self-check, removed).

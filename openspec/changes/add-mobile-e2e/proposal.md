# Proposal: Phone-sized E2E coverage

## Why

The founder (2026-10-09): "Do some e2e on mobile view as well, make sure all features are accessible in mobile as
well." Today the E2E suite runs on a desktop Chromium viewport. A few specs resize to 320–390 px for one check each
(reflow, the theme switch, the vault column), but nothing proves that every page and every vault feature can be
reached and used with taps on a phone.

## What Changes

- A `mobile` Playwright project: Chromium emulating a Pixel 7 (`isMobile`, `hasTouch`, coarse pointer). It re-runs the
  feature specs that matter on a phone (listed in design.md D2) and the new mobile spec.
- A `mobile-small` project: the same phone at 360 px wide, running only the new mobile spec.
- A new spec, `e2e/specs/21-mobile.spec.ts`, that walks every route and every vault screen at phone width and checks:
  no horizontal page scroll; every nav item, menu, theme switch, footer link, CTA, disclosure and vault action is
  visible, inside the viewport and operable by tap; interactive targets are at least 24×24 CSS px (WCAG 2.2 2.5.8),
  with anything under 44 px reported as advisory; no clipped or overflowing text; the core flow (create with two
  keys, unlock, reveal, copy, add a key, all vaults, details, rename or archive, lock) works with taps.
- Mobile defects the spec finds are fixed in `apps/web` with minimal CSS/markup changes (recorded in design.md D5).

## Out of scope

- WebKit/Safari and Firefox mobile emulation: the CDP virtual authenticator with PRF exists only in Chromium; real
  iOS/Android hardware stays on the manual checklist (`apps/web/docs/hardware-test.md`).
- Visual redesigns of the phone layout; only defects are fixed.
- Copy changes (the copy rules in `apps/web/test/landing/banned.ts` stay as they are).
- Any change to crypto, contracts, the paymaster, writes or secret handling.

## Impact

- `apps/web/playwright.config.ts`, `apps/web/e2e/specs/21-mobile.spec.ts`, `apps/web/e2e/README.md`, and the CSS or
  markup of any defect found.
- CI: `test:e2e` already runs every Playwright project with the Chromium it installs; no workflow change is needed.
  The added E2E time is recorded in tasks.md.
- **Runtime dependencies:** none added. No CryoShield-operated backend.

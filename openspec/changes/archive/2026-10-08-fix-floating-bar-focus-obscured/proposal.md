# Proposal

## Why

`main` went red. The full-CI run of the Deploy workflow (run 37236296475, commit `d1b1dfc`) failed `web-e2e` on
`30-a11y.spec.ts`, "the floating action bar never hides the focused field (WCAG 2.4.11)". It passes in PR CI and has
flaked before (PR #21). Locally it failed 2 of 30 runs.

**Root cause (a product bug, not just the test).**
- Since `app-motion-ux`, a newly added secret row enters with a **height tween** (`Collapse`: `height 0 → auto` over
  0.22 s).
- While it grows, everything below it moves down.
- A keyboard user who adds a row and tabs on straight away focuses a control below it. The browser (honouring
  `scroll-padding-bottom`) and our `useFocusClearOfActionBar` nudge scroll that control clear of the sticky bar. Then
  the still-growing row pushes it **back under the bar**.

Instrumented runs showed the document height growing between Tabs (2461 → 2834 px). The obscured control was
correctly positioned when it received focus and pushed under the bar afterwards.
- **Why CI is worse:** slower runners stretch the overlap window.
- **The `color-contrast` failure** in the same test's final audit has the same cause: a stale scroll position left
  text under the translucent bar.

A second, latent gap: `scroll-padding-bottom` was `--bar-h` (64 px) + 32 px. The real bar is 70 px tall on one row
and taller when its buttons stack on phones (the vault editor's Save + Cancel is about 126 px). So the CSS alone
didn't keep fields clear, and only the JS nudge did.

## What Changes

- **`Collapse` never changes layout over time.** Enter is a paint-only top-down clip reveal plus fade (`clip-path`,
  `opacity`). Removal is immediate, with no exit tween. It's instant under reduced motion. This applies to editor
  rows, the vault list and the Details disclosure.
- **CSS guarantee:** `scroll-padding-bottom` equals the bar's real footprint (`--bar-footprint`: sticky offset,
  border, padding, rows of 44 px targets, and a gap). On phones a `:has()` rule raises `--bar-rows` to match the
  stacked buttons. The JS nudge stays as defence in depth.
- **Deterministic E2E:**
  - New helpers `animationsDone()` (every Web Animation finished) and `layoutStable()` (document height, scroll and
    focused rect unchanged across frames).
  - The test measures each Tab **immediately and again once settled**, with and without reduced motion.
  - A new vault-editor phone test covers stacked Save + Cancel.
  - A new invariant test checks that **nothing moves a field after it gets focus**. It adds a row and focuses below
    it in the same task. It fails 5/5 on the old code and passes on the new.
- **Audit:** `07-scenes` measured after fixed sleeps (`waitForTimeout(200/250)`). It now waits on the real state
  (`--p` reaching the target, and polling the timeline geometry). Other sleeps are deliberate negative assertions
  (time must pass) and stay.

## Capabilities

### New Capabilities
- `app-motion`: a requirement that motion never moves a focused field. The `app-motion` spec is still in the
  unarchived `app-motion-ux` change, so it's added here as a new requirement.

## Impact

- **Code:** `apps/web/src/ui/{motion.ts, motionkit.tsx, global.css}`.
- **Tests:** `apps/web/e2e/{fixtures/motion.ts, specs/30-a11y.spec.ts, specs/07-scenes.spec.ts}`, plus a unit test in
  `test/ui/motion.test.ts` and a CSS test in `test/ui/tokens.test.ts`.
- **Behaviour:** rows reveal top-down instead of growing, and removal is instant. No workflow, CSP or dependency
  change.

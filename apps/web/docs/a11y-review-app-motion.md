# Accessibility review: app-motion-ux (WCAG 2.2 AA)

**Verdict: pass with conditions. No blockers. The conditions are met in this PR.**

## What passes

### Focus and transitions
- The leaving step is `inert`.
- The new step's heading is focused when it mounts, which happens after the transition.
- Returning home or to the vault list focuses that screen's h1.
- E2E: a keyboard-only create and unlock run, plus `12-motion` (focus on every transition, checked once the screen is
  at rest).

### Live regions
- Errors keep `role=alert`.
- The save checklist states each step in text (`: done` / `not yet`) and has a polite live region.
- Copy is announced by the existing status text. The chip and countdown bar are `aria-hidden` extras.

### No information conveyed by motion alone
- The save checklist states every step in text.
- The countdown bar's information is also in text: "Clipboard clears in 30 s".
- The key slots and the ✓ come with text ("Key 1 is ready.").

### Reduced motion
- `MotionConfig reducedMotion="user"` is in place.
- Transitions and feedback are opacity-only.
- There is no blur, and the pulse is a static ring.
- The height animation is instant.
- E2E samples every frame and checks for no transforms or filters.
- axe passes.

### Controls
- The Details disclosure is a button with `aria-expanded`. `aria-controls` is set only while the panel is open.
- Every target meets 44 px or more.

## Findings and fixes

- **Major, SC 2.2.2: the waiting pulse looped forever.** Fixed: it now pulses twice (about 4.8 s) and then rests.
  Covered by a unit test.
- **Minor: `aria-controls` pointed at a panel that wasn't there.** Fixed: it is now set only while the panel is open.
- **Minor, SC 2.3.3: the height animation still ran under reduced motion.** Fixed: it is now instant under reduced
  motion.

## Known and accepted

- Focus sits on `body` for about 0.2 s while a step exits.
- The ceremony live region keeps its existing pre-motion markup. A follow-up could make it a persistent region.

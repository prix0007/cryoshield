# Design

## Evidence

An instrumented run (390×600, three rows added, then 16 Tabs, logging each step) showed:
- the last row's `offsetHeight` going 82 → 215 → 281 → 333 → 409 → 417 during the first Tabs;
- `document.scrollHeight` growing with it;
- in the failing runs, step 12 (the "Add another secret" button): positioned clear of the bar when it got focus, then
  measured under it (`[512.8, 556.9]`, bar top 513).

No CSS changes layout on focus, and the only running animations were Motion's on the row wrappers.

## D1. Paint-only enter, instant removal

`collapse = { initial: { opacity: 0, clipPath: 'inset(0 0 100% 0)' }, animate: { opacity: 1, clipPath: 'inset(0 0 0% 0)' } }`
with no `exit`.
- **Layout is final at mount:** the element takes its full size immediately, so whatever the browser scrolled to on
  focus stays correct.
- **Exit:** an exit tween (height, or a fade that keeps the row in flow) would move content again after removal, so
  removal is immediate.
- **Reduced motion:** `initial={false}`, so nothing animates.
- **Unit test:** no layout property may appear in the variants.

## D2. The CSS footprint

`--bar-footprint = sticky offset (space-md) + 2px border + 2×space-sm padding + rows×target + (rows−1)×space-sm + space-md gap`.
- **Default:** `--bar-rows: 1`.
- **Phones (≤ 419 px), where buttons stack:** `html:has(.action-bar > :nth-child(n))` sets 2, 3 or 4.
- **Static bars:** card bars and bars on short screens are counted too. That only adds padding, which is harmless.
- **Limits:** this keeps focus scrolling clear for every current bar. The `focusin` nudge (which measures the real bar)
  remains for anything CSS can't predict.

## D3. Deterministic tests

- **Settled measurement:** `animationsDone()` covers CSS and WAAPI. `layoutStable()` requires 4 identical frames of
  document height, scroll position and the focused rect, which also catches JS-driven tweens that `getAnimations()`
  doesn't see.
- **Measure twice:** once immediately after each key press (what the user sees first) and once settled (catches later
  movement).
- **Invariant test:** in one task it adds a row and focuses the checkbox below it, records its document position,
  settles, and requires the position to be unchanged. It proves the root cause is gone without relying on timing.

## Risks

- **[Rows no longer "grow"]** → the reveal still reads as an expand (top-down clip). An a11y guarantee beats a
  height tween.
- **[`:has()` support]** → it's in every supported browser (Chrome/Edge 105+, Firefox 121+, Safari 15.4+). Without
  it, the JS nudge still applies.

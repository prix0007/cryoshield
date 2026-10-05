# Tasks

## 1. Root cause and product fix

- [x] 1.1 Reproduce (2/30 local failures) and instrument: row height and document height grow after focus; the obscured control was clear when it got focus.
- [x] 1.2 `Collapse`: paint-only clip and fade enter, instant removal, no animation under reduced motion. Unit test: no layout properties in the variants.
- [x] 1.3 `scroll-padding-bottom` = `--bar-footprint` (real bar geometry; `:has()` for stacked phone bars). CSS test.

## 2. Deterministic tests

- [x] 2.1 `animationsDone()` and `layoutStable()` in `e2e/fixtures/motion.ts`.
- [x] 2.2 `30-a11y`:
  - the phone test measures immediately and settled, with and without reduced motion;
  - a new vault-editor phone test (stacked Save + Cancel);
  - a new invariant test, "nothing moves a field after it gets focus" (fails 5/5 on the old code).
- [x] 2.3 Audit the other specs: `07-scenes` waits on real state instead of fixed sleeps; the remaining sleeps are deliberate negative assertions.

## 3. Verification

- [x] 3.1 The bar specs at `--repeat-each=30` with 0 failures; the full E2E suite 3× green; unit, verify-build and OpenSpec pass.

# Security review: app-motion-ux

The CryoShield security reviewer looked at commits `ad9a16b` and later on `feat/app-motion-ux`.

**Verdict: APPROVE WITH NITS.** No critical, high or medium findings. Every finding below is fixed in this PR.

## Guardrails

### (a) Motion never gates security behaviour
- **Progress events:** these go through `notify()`. It runs synchronously, is never awaited, and catches both throws
  and rejections. Each event fires after the real event it reports. The sponsor only ever receives a guarded listener.
- **Ceremonies:** they start inside the click handler, before any animation frame. A frozen-timer and frozen-frame test
  covers this, and a mutation that deferred the ceremony to the next frame made the test fail.
- **Lock, idle wipe and PRF wipe:** top-level screens animate in only, so Lock, the idle auto-lock and the CreateFlow PRF
  wipe all happen in the same React commit. A unit test checks the revealed secret is gone from the DOM in that commit.
- **CreateFlow idle wipe:** it bumps an epoch that drops the old step with no exit animation.
- **Leaving content is `inert`:** this applies to steps and editor rows, so nothing typed or clicked during the 0.22 s
  exit can land on it.

### (d) No secret in motion state
- **Keys:** animation keys are only step names, list positions, a local row counter and a copy counter.
- **Reveal:** a revealed secret is passed only as children. Only blur and opacity are animated.

### (f) CSP unchanged
- **Headers:** no CSP or headers source changed.
- **Code paths:** nothing in `src/` uses `popLayout`, the only code path that injects `<style>`. Neither eval nor
  `Function` is used.
- **Feature chunk:** it is served from the same origin under `/assets`.
- **E2E:** the suite records no CSP or Trusted Types console violations and no page errors.

### (g) One Motion dependency
- **Pin:** a single `motion@13.5.0` pin, checked by a test.
- **Lockfile:** unchanged.
- **Landing page:** byte-identical and still free of React. verify-build fails if `/app` and the landing page share a
  chunk.

### Clipboard
- **Timer:** the clear timer is unchanged.
- **Presentation callback:** it fires after the clear attempt and is dropped on unmount.

## Findings and fixes

- **LOW: a removed editor row could still be typed into during its exit.** Fix: rows leaving the list are now `inert`.
- **LOW: the copy chip disappeared even when the clear was skipped because the page was out of focus.** Fix: the
  callback now reports whether the clear ran. The user is told when the clipboard was not cleared, and the listener is
  forgotten on unmount. Unit test added.
- **NIT: the build plugin's `load` did not re-check the module path.** Fix: it now checks that the path belongs to a
  Motion package.
- **NIT: indentation, test coverage and the baseline figure.**
  - The indentation in `writes.ts` is fixed.
  - There is now a throwing-listener test for create.
  - The baseline figure is aligned to 194,690 B.

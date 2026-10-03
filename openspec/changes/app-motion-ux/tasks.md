# Tasks

## 1. Foundations (tests first)

- [ ] 1.1 Unit tests `test/ui/motion.test.ts` for the pure variant factories (direction, reduced variants, countdown duration = `CLIPBOARD_CLEAR_MS`, no transform in reduced variants). Implement `src/ui/motion.ts`.
- [ ] 1.2 Root `LazyMotion strict` + `MotionConfig reducedMotion="user"`, the ESLint ban on `motion`/`framer-motion` imports (verified by a lint fixture test), and `MotionGlobalConfig.skipAnimations` in the unit-test setup.
- [ ] 1.3 Guardrail (a): a unit test that, with frozen timers and RAF, clicking "Set up key 1" calls `credentials.create` once microtasks settle. Keep it green through every later task.

## 2. Write-path progress (security-relevant)

- [ ] 2.1 Unit tests (writes + operations): a fake sponsor and reader emit `encrypted`, `sponsored`, `sent`, `confirmed` in order; a throwing `onProgress` doesn't break the write; nothing awaits it. Implement D5.

## 3. UI

- [ ] 3.1 Step transitions (App, CreateFlow, UnlockFlow, VaultView), focus after transition, and the `Btn`/`whileTap` system with the CSS press removed. Verify the existing unit tests still pass.
- [ ] 3.2 Ceremony pulse, key-slot fill with ✓ draw, error shake/slide; the save checklist driven by real events (unit test: stalled at signing shows exactly two ✓).
- [ ] 3.3 Secrets reveal un-blur, copy pop + countdown bar (unit: bar keyed by a counter; the clipboard timer is unchanged), list enter/exit, and the Details disclosure with height animation (unit: `aria-expanded` toggles).

## 4. Verification

- [ ] 4.1 verify-build: the `/app` initial gzip ≤ 194,689 + 20,480 B, printed; the landing checks are unchanged.
- [ ] 4.2 E2E `12-motion.spec.ts`: each transition's end state (focused heading, opacity 1, no transform), the save checklist reaching all stages in a real create, reduced motion (no transforms, text present), and no CSP/TT console violations or page errors across create/unlock/edit/add-key/copy; axe with reduced motion. The existing E2E stays green.
- [ ] 4.3 Screenshots of the key states in `apps/web/docs/screenshots/`.

## 5. Reviews

- [ ] 5.1 Security review: the progress hooks can't delay or alter writes, no secret in motion state, the CSP is unchanged, and the privacy tests are green. Record it in `apps/web/docs/security-review-app-motion.md`.
- [ ] 5.2 Accessibility review: focus, live regions, reduced motion, no motion-only information, and axe. Record it in `apps/web/docs/a11y-review-app-motion.md`.

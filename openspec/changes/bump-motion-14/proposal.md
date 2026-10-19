# Proposal

## Why

Dependabot proposed `motion` 13.5.0 → 14.0.0 (#115) and CI refused it: the `app-motion-ux` guardrail pins Motion
to one exact version (`apps/web/test/build/motion-pin.test.ts`) and `docs/design/ASSETS.md` must record that
version (`assets.test.ts`). Dependabot cannot move those, so the pin moves here, as its own change.

Motion 14.0.0 (2026-10-02) has one change: it removes the internal compatibility shims that 13.5.1 had restored
for installs mixing `framer-motion` 13.0–13.4 with newer `motion` internals, now that `motion` pins its own
`framer-motion`, `motion-dom` and `motion-utils`. CryoShield has no direct `framer-motion` dependency (the pin
test forbids one), so nothing it imports is affected. The 13.5.1 fixes ride along (`inherit={false}`,
`sortNodePosition` on an unmounted sibling, SVG attribute fallback). Staying on 13.5.0 would leave the app on a
line that no longer receives fixes.

## What Changes

- `apps/web/package.json`: `motion` pinned to `14.0.0`; `pnpm-lock.yaml` resolves `motion`, `framer-motion`,
  `motion-dom` and `motion-utils` at exactly 14.0.0, each with a new integrity hash.
- `apps/web/test/build/motion-pin.test.ts`: the guardrail names `14.0.0`.
- `docs/design/ASSETS.md`: the Motion row records `motion@14.0.0`, its usage column names every import site
  (it still said "landing page only", which has been wrong since `app-motion-ux`), and the CSP-compatibility
  section records the grep of the 14.0.0 dists.
- `openspec/specs/app-motion`: the "Lazy features and budget" requirement states that the pin is exact, recorded
  in `ASSETS.md`, and checked by a test, which is what the guardrail already enforced.

## Out of scope

- Any change to how the app uses Motion (`LazyMotion`, `m.*`, `motion/mini`, `scroll`), the lint rules, the
  bundle budgets, or the landing isolation.
- The dated security-review records under `apps/web/docs/` that mention 13.5.0. They describe the state they
  reviewed and stay as written; `design.md` here is the review of this bump.
- Dependabot's own PR #115, which GitHub closes once `main` carries the same version.

## Runtime dependencies

No new dependency. One existing browser-side dependency changes version. Nothing is operated by CryoShield;
Motion is bundled into the static site and served from `'self'`.

## Capabilities

### Modified Capabilities
- `app-motion`: the single pinned `motion` dependency is an exact, recorded, tested pin.

## Impact

- **Changed:** `apps/web/package.json`, `pnpm-lock.yaml`, `apps/web/test/build/motion-pin.test.ts`,
  `docs/design/ASSETS.md`, `openspec/specs/app-motion/spec.md` (on archive).
- **CI:** `web` (unit, lint, typecheck, `verify-build`) and `web-e2e` run; `vault-crypto` and `contracts` are
  unaffected.
- **Bundle:** `/app` initial gzip stays inside the `app-motion-ux` budget (see `design.md`).

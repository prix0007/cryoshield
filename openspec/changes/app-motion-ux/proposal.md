# Proposal

## Why

The founder wants the vault app to feel "way better" with Motion for React (motion.dev/docs/react). Today `/app`
switches screens abruptly, the key ceremony is a static card, and the save is a single "Saving…" line, so users can't
see what has actually happened. Motion is already a pinned dependency (the landing page uses its vanilla API).

## What Changes

- **`/app` only:** the landing page stays React-free.
- **Root setup:** `LazyMotion features={domAnimation} strict` and `MotionConfig reducedMotion="user"`. Only `m.*`
  components are used, and a lint rule bans `motion.*`.
- **Step transitions:** `AnimatePresence mode="wait"` with direction-aware slide + fade for the home, create,
  unlock and vault screens, the create-flow steps, and the vault modes. Focus moves to the new step's heading after
  the transition.
- **Key ceremony:**
  - the waiting card pulses;
  - an enrolled key's slot fills with a spring and a ✓ that draws itself;
  - an error notice shakes once and its message slides in.

  All of it is driven by the real ceremony state.
- **Save sequence:** a checklist (encrypted on this device → network fee sponsored → signed and sent → confirmed
  on-chain → Arweave copy). Each item is checked ONLY when the real event arrives from the write path. There are no
  timers and no simulated progress.
- **Secrets view:** reveal un-blurs on explicit request; a copy-confirmation pop; the 30 s clipboard auto-clear shown
  as a shrinking bar plus text.
- **Lists:** secrets and key slots animate in and out (enter/exit height and opacity).
- **Buttons and disclosures:** `whileTap` scale 0.95 on every button (replacing the CSS press), a subtle hover lift
  only for hover-capable pointers, and the Details disclosure height animation.
- **Write-path events:** `createVaultOnChain`/`updateVaultOnChain`/`addKeyOnChain` and the sponsor emit progress
  notifications (fire-and-forget, never awaited, exceptions swallowed). Behaviour is otherwise unchanged.

**Guardrails (specified and tested):**
- **(a)** animation never delays or gates a ceremony, a write or any security behaviour;
- **(b)** reduced motion means instant or opacity-only;
- **(c)** `LazyMotion` + `m` only, with `/app` initial JS gzip ≤ baseline + 20 KB (enforced in verify-build) and the
  landing bundle unchanged;
- **(d)** no secret, PRF output, key or address in animated values or keys;
- **(e)** focus and live regions keep working, with no motion-only information, and axe passes;
- **(f)** the CSP is unchanged, with no CSP or Trusted Types console violations;
- **(g)** a single `motion@13.5.0` dependency.

**Out of scope:** the landing page; new product features; the `layout` prop (needs `domMax`, about +10 KB over
budget; see design D2).

**Runtime dependencies:** none new (`motion@13.5.0` is already pinned). No backend, no new origin.

## Capabilities

### New Capabilities
- `app-motion`: the vault app's motion system and its guardrails.

### Modified Capabilities
None in `openspec/specs/` (the vault app's behaviour specs are in the unarchived `add-web-app` change; the write-path
progress events are additive notifications).

## Impact

- `apps/web/src/main.tsx` and `src/ui/*` (App, CreateFlow, UnlockFlow, VaultView, components, chrome, the new
  motion helpers);
- `src/account/writes.ts` and `src/ui/operations.ts` (progress events);
- `src/ui/global.css`, `eslint.config.js`, `scripts/verify-build.mjs`;
- tests: unit, E2E (transitions, reduced motion, console CSP), verify-build. Screenshots are added.

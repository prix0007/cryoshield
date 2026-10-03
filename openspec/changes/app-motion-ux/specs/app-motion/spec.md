# Spec Delta

## Purpose

Defines how the vault app animates (step transitions, key ceremony, save progress, secrets, lists, buttons) and the
guardrails that keep motion purely decorative: never delaying security behaviour, respecting reduced motion,
staying in budget and CSP, and never touching secret values.

## ADDED Requirements

### Requirement: Motion never gates security behaviour
Animations SHALL be concurrent decoration. A WebAuthn ceremony, a signature, a write, an idle wipe, a zeroization or
a clipboard clear MUST NOT wait for any animation, transition or animation frame.

#### Scenario: Ceremony starts in the gesture's task
- **WHEN** the user activates "Set up key 1" while animation frames and timers are frozen
- **THEN** `navigator.credentials.create` has been called once microtasks settle, before any animation frame runs

### Requirement: Reduced motion
The app SHALL wrap its UI in `MotionConfig reducedMotion="user"`. When the user prefers reduced motion, transitions
SHALL be instant or opacity-only (no transform, no blur), and every piece of information SHALL still be shown as text.

#### Scenario: Reduced-motion transition
- **WHEN** reduced motion is emulated and the user moves from home to the create intro
- **THEN** the new heading has focus, its container has no transform, and the countdown and progress are readable as text

### Requirement: Lazy features and budget
The app SHALL load Motion via `LazyMotion features={domAnimation} strict` and use only `m.*` components; importing
`motion` from `motion/react` or `framer-motion` SHALL be a lint error. The `/app` initial JavaScript MUST stay within
20 KB gzip of the pre-change baseline, and the landing page's JavaScript graph MUST NOT include React or Motion's
React code. Motion SHALL come from the single pinned `motion` dependency.

#### Scenario: Budget enforced
- **WHEN** `verify-build` runs
- **THEN** it prints the `/app` initial gzip size and fails if it exceeds the baseline plus 20 KB, and the landing checks are unchanged

### Requirement: Save progress reflects real events only
The save checklist SHALL mark a stage done only when the write path reports that event: encrypted (blob built),
fee sponsored (paymaster data returned), signed and sent (user operation accepted by the bundler), confirmed on-chain
(registry read-back), and Arweave copy (mirror saved). No stage MAY advance on a timer.

#### Scenario: Stalled at signing
- **WHEN** the paymaster has sponsored but the signature has not completed
- **THEN** exactly "Encrypted on this device" and "Network fee sponsored" are checked and the rest are pending

### Requirement: Secrets are never animated values
No secret, PRF output, key, credential ID or address SHALL be passed to Motion as an animated value or motion value,
or used as an animation key. Reveal SHALL animate only presentation (blur and opacity) of text the user explicitly
asked to show. The clipboard countdown SHALL animate a bar unrelated to the copied value.

#### Scenario: Copy countdown
- **WHEN** the user copies a secret
- **THEN** a confirmation and a 30-second shrinking bar appear, keyed by a counter, and the clipboard is cleared by the existing timer regardless of animation

### Requirement: Accessible transitions
After a step transition, focus SHALL move to the new step's heading. Live regions (ceremony prompt, save checklist,
errors) SHALL keep announcing. The app SHALL pass axe (WCAG 2.2 AA) with motion enabled and with reduced motion.

#### Scenario: Focus after transition
- **WHEN** the user moves between create steps by keyboard
- **THEN** after each transition the new step heading is focused and axe reports no violations

### Requirement: CSP unchanged
Motion SHALL apply styles only through the CSSOM. The app CSP SHALL be unchanged, and no CSP or Trusted Types
violation SHALL be logged during the animated flows.

#### Scenario: No violations
- **WHEN** the E2E suite runs create, unlock, edit, add-key and copy with motion enabled
- **THEN** the console logs no CSP or Trusted Types violation and no page error

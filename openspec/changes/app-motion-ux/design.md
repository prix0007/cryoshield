# Design

## Context

- **Motion:** `motion@13.5.0` is already pinned for the landing page (vanilla `scroll`). `motion/react` exports
  `LazyMotion`, `domAnimation`, `MotionConfig`, `AnimatePresence` and `useReducedMotion`, and `motion/react-m` exports
  `m` (docs: motion.dev/docs/react, react-reduce-bundle-size, react-accessibility).
- **Bundle sizes per the docs:** `m` ≈ 4.6 KB; `domAnimation` +15 KB (animations, variants, exit, tap/hover/focus);
  `domMax` +25 KB (adds layout and drag).
- **Baseline:** the `/app` initial JS is 194,689 B gzip (origin/main `32ae235`, e2e build).
- **Real write events:** in viem's ERC-4337 flow, the paymaster data comes before the WebAuthn signature, then the
  bundler accepts the user operation, then the receipt arrives, then our read-back confirms.

## Decisions

### D1. Root wiring
`App` renders `<LazyMotion features={loadFeatures} strict><MotionConfig reducedMotion="user">` (`MotionRoot`).
- `loadFeatures` is `() => import('./motion-features')`, so `domAnimation` is a separate same-origin chunk fetched
  after first render (the Motion docs' async pattern). Static `domAnimation` measured +31.3 KB initial (over budget);
  async measured +18.75 KB initial with a 15.9 KB lazy chunk. Until it arrives, elements render in their final state.
- `strict` makes any accidental `motion.*` throw.
- ESLint `no-restricted-imports` bans `motion` from `motion/react`, and bans `framer-motion` entirely, in `src/**`
  (tested in `test/build/lint-motion.test.ts`).

### D2. No `layout` prop (deviation from the plan)
`layout` needs `domMax`, about +10 KB more, which would exceed the 20 KB budget. Key slots and secret items animate
with enter/exit (`opacity`, `height`, a spring `scale`) inside `AnimatePresence`, which `domAnimation` covers. The app
has no reorder UI, so reorder animation is not applicable.

### D3. Transitions
- **Variants:** `src/ui/motion.ts` exports pure variant factories (`stepVariants(direction)`, `shake`, `pop`, `reveal`,
  `countdown`), unit-tested.
- **Direction:** forward/back is derived from step order.
- **Duration:** about 0.22 s with `mode="wait"`, so the old step exits before the new one mounts. Its `StepHeading`
  focuses on mount, which gives "focus after transition" for free. Returning home or to the vault list focuses that
  screen's h1 the same way.
- **Leaving step is `inert`** (`useIsPresent`), so no click or key press lands on a step that is animating out.
- **Top-level screens animate in only** (`ScreenTransition`, no exit): Lock, the idle auto-lock and leaving a flow
  unmount the previous screen in the same commit, so revealed secrets leave the DOM and CreateFlow's PRF wipe on
  unmount run at once. Inside CreateFlow the idle wipe bumps an `epoch` that remounts the presence, dropping the old
  step with no exit.
- **Presence boundary:** `AnimatePresence initial={false}` propagates through context to every descendant, which
  would make content mounted later (reveal, copy bar) start at its end state. Step and row contents get a fresh
  `PresenceContext`.
- **Reduced motion:** `MotionConfig reducedMotion="user"` drops transforms, so only opacity remains. The blur on
  reveal is removed via `useReducedMotion`, because filter is not a transform.

### D4. Ceremony and errors
- `KeyPrompt` (waiting) has a looping pulse on a decorative `aria-hidden` element.
- Key slots in the create flow fill with a spring, and a ✓ path draws in (`pathLength`), keyed by slot index.
- Error `Notice`s mount with a one-off horizontal shake and a message slide.
- The text, roles and live regions are exactly as before. Motion only decorates.

### D5. Real-event save checklist
- **Events:** `WriteDeps.onProgress?(stage)` and `Sponsor.send(…, onProgress)` emit:
  - `encrypted` after the blob is built (create: per attempt; edit and add-key: before the account is built);
  - `sponsored` when `getPaymasterData` returns;
  - `sent` when `sendUserOperation` returns a hash (the signature has been produced);
  - `confirmed` after the read-back.

  The mirror status supplies `arweave`.
- **Safety:** each emit is `try { cb(stage) } catch {}`, never awaited, so a UI bug can't break or delay a write.
- **Display:** `SaveProgress` renders the stages in true order, ✓ for reached and pending for the rest. A VaultIdTaken
  retry resets to pending.

### D6. Secrets, clipboard, buttons, disclosure
- **Reveal:** shown secrets mount in an `m.pre` animating `filter: blur(8px) → 0` and `opacity`. The secret text is
  children, never an animated value.
- **Copy:** a pop chip "Copied" plus a bar `scaleX 1 → 0` over `CLIPBOARD_CLEAR_MS`, keyed by a copy counter. The
  text "Clipboard clears in 30 s" stays.
- **`Btn`:** an `m.button` with `whileTap={{ scale: 0.95 }}` (not when disabled) and `whileHover={{ y: -1 }}`.
  Motion's hover ignores touch pointers. The CSS `:active` scale is removed for app buttons, so they don't scale
  twice.
- **Details:** a button with `aria-expanded`/`aria-controls` and an `m.div` animating height inside
  `AnimatePresence`. It replaces `<details>` in error and mirror notices.

### D7. Landing isolation
`/app` and the landing page share some motion-dom / motion-utils / framer-motion modules, and the bundler hoisted those
into shared chunks, re-splitting the landing's lazy runtime (+0.46 KB). `vite-plugins/app-motion-isolation.ts` (build
only) tags every Motion module reached from `src/ui` with `?app-motion`, giving `/app` its own instances. The landing
JS graph is byte-identical to origin/main (all chunk hashes equal), and verify-build fails if `/app` and the landing
share any chunk except Vite's preload helper.

## Threat / abuse

- **Ceremony timing:** progress notifications are synchronous, fire-and-forget and exception-proof; nothing awaits
  them. Transitions run after the state changes that trigger them, never before a ceremony call. There is a unit test
  with frozen RAF and timers.
- **Data in animation state:** Motion receives only numbers and strings we author (offsets, opacity, blur, scale).
  Keys are step names, slot indices, a local row counter (editor) and a copy counter. Secrets are rendered as
  children only after the existing explicit Show.
- **Lock / idle wipe:** never behind an exit animation (D3); a unit test asserts the revealed secret is gone in the
  same commit as Lock, with timers and frames frozen.
- **Supply chain:** the same pinned `motion` package. The React entry is bundled into `/app` only; verify-build keeps
  the landing graph free of React.

## Risks / Trade-offs

- **[Exit animations delay the next screen by about 0.2 s]** → decoration only; no security action is queued behind
  them.
- **[jsdom has no WAAPI]** → unit tests set `MotionGlobalConfig.skipAnimations`, and E2E checks real end states.
- **[Audits mid-transition]** → axe measures contrast on partly faded text, so E2E audits wait for a settled screen
  (`e2e/fixtures/motion.ts`). Users only see such frames for about 0.2 s.
- **[Bundle]** → `/app` initial +18.75 KB of the 20 KB allowance; any further motion feature must come out of it.

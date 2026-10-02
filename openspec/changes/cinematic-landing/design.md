# Design

## Context

- The landing page (`index.html`, `src/landing/*`) is static HTML. A 0.5 KB boot module lazy-loads a 7 KB Motion
  chunk; every graphic's static state is its final state.
- The CSP is strict (`script-src 'self'`, Trusted Types `'none'`, `style-src 'self'`) and identical on `/` and `/app/`.
  CSSOM writes (`el.style.setProperty`) are allowed.
- The hover bug comes from `src/ui/chrome.css`: `.global-nav a:hover` and `.pill:hover` set
  `text-decoration: underline`. The landing page's `.footer-links a:hover` does the same.

## Goals / Non-Goals

**Goals:**
- Drama through scale, motion and light, with no new claims.
- 60 fps by animating only `transform` and `opacity`.
- No layout change from JS (CLS 0).
- No JS on the critical path beyond the boot module.

**Non-Goals:**
- WebGL.
- Audio.
- Horizontal scroll-jacking.
- Smooth-scroll libraries (Lenis etc.) that take over native scrolling.

## Decisions

### D1. Pinned scenes are native sticky stages driven by one progress variable
- **Markup:** each scene is `<section class="scene" data-scene="name">` containing a tall `.scene-track` with a
  `position: sticky; top: <header height>` `.scene-stage` inside.
- **Progress:** `scenes/runtime.ts` uses Motion's `scroll(cb, { target: track, offset: ['start start', 'end end'] })`.
  It writes `--p` (0..1) on the stage with `style.setProperty` (CSSOM, CSP-safe) and calls the scene's own
  `update(p)` for the few non-CSS effects (year counter, ciphertext scramble).
- **Visuals:** these are CSS `calc()`s of `--p` on `transform`/`opacity`. Each layer is clamped with
  `clamp(0, (var(--p) - a) / (b - a), 1)` sub-ranges, so one variable choreographs a whole scene.
- **Track height comes from CSS alone:**
  - `300vh` under `prefers-reduced-motion: no-preference`;
  - `200vh` at ≤ 640px;
  - `auto` (no pin) under reduced motion.

  JS never changes layout, so CLS stays 0.
- **Defaults:** without JS, `--p` defaults to `1`, so a pinned stage shows the scene's final state, and the text is
  always in the HTML.
- **Reduced motion:** stages are static, `--p: 1`, and no scene code loads.
- **Rejected alternatives:**
  - *CSS scroll-driven animations* (`animation-timeline: view()`) need no JS, but are not supported in Firefox and
    Safari at the required level. Motion's `scroll()` uses the native ScrollTimeline where it can and falls back to
    rAF.
  - *GSAP ScrollTrigger:* its license is not OSI-approved, and it adds weight.

### D2. No WebGL
SVG and CSS transforms render every scene in the brief: beams, cracks, shards, blocks, a timeline. They stay sharp,
accessible to the theme tokens, and cost about 2–4 KB per scene. three.js would add about 150 KB gzip, which is over
budget and adds a second rendering surface to audit, for no gain in the story.

### D3. Code splitting
- **`main.ts` (initial, ≤ 15 KB):** boot, the magnetic-CTA pointer effect (fine pointers only), the number counters,
  and one `IntersectionObserver` that imports `scenes/runtime.ts` plus the scene's own module (`scenes/<name>.ts`)
  when a scene is within one viewport.
- **Motion:** shared by the runtime and the existing tile animations.
- **Budget:** each lazy chunk ≤ 40 KB, total ≤ 120 KB. The expected total is about 20 KB. The ceiling is set by the
  founder's brief and leaves room to iterate without re-approval.

### D4. Hero
- **Type:** the headline is set at `clamp(44px, 9vw, 128px)`, weight 600, tracking -0.03em (larger than the guide's
  56px; the founder asked for "larger than life").
- **Kinetic text:** words rise with CSS transform keyframes only. Opacity stays 1, so LCP is unaffected.
- **Key animation:** the key drifts in, docks into a port on the shield, and pulses twice. This is CSS only, on load,
  and off under reduced motion.
- **Parallax:** a slow parallax of the hero visual on scroll, through the runtime.

### D5. Numbers band
Five figures, chosen to be honest and checkable:
- "1 tap" to open;
- "2+ keys" enrolled;
- "0 copies we hold" (CryoShield holds no plaintext and no keys);
- "$0 network fees" (sponsored);
- "~1 KB" per vault.

They count up once in view, using rAF and `textContent`. The final value is in the HTML, so no JS still shows it.

### D6. Link decoration
- `chrome.css`:
  - `a { text-decoration: none }` for chrome: `.global-nav a`, `.wordmark`, `.pill`, `.footer-links a`, `.skip-link`;
  - hover is `opacity: .72` on nav, logo and footer links;
  - pills keep their press scale and get no hover underline.
- Body-copy links (`p a`, `li p a`, `.faq a`) are `underline` at rest, with `text-underline-offset: 3px`.
- App buttons are `<button>` elements (no underline by default); the app nav shares `chrome.css`.

### D7. Mobile
At ≤ 640px:
- tracks are 200vh;
- secondary layers (parallax background, shards' extra fragments) are hidden;
- stages are sized to `100svh` minus the header;
- the magnetic effect is disabled for coarse pointers;
- nothing listens for `wheel` or `touchmove`.

## Threat / abuse considerations

- **CSP:** unchanged. Scene code uses only `textContent`, `classList` and `style.setProperty`; there is no
  `innerHTML`, eval or WASM. verify-build greps the landing graph for these sinks (new check) and still asserts that
  no React/viem/vault code is present.
- **Supply chain:** no new dependency. Motion stays pinned.
- **Honesty as a safety property:** overclaiming permanence could lead users to delete their other backups. The copy
  keeps the caveats, and unit tests enforce a denylist ("guaranteed", "forever", "unbreakable", "never lose") plus the
  required disclosures.
- **Distraction during key ceremonies:** none. Scenes exist only on `/`, and `/app/` is unchanged apart from the
  hover fix.

## Risks / Trade-offs

- **[Long page]** Six pinned tracks of 300vh make a long scroll → mobile tracks are shorter, the skip link and nav
  anchors jump over scenes, and keyboard paging works natively.
- **[Lighthouse variance]** Lab numbers vary by machine → the doc records the run conditions and the median of three
  runs.
- **[Motion fallback]** Browsers without ScrollTimeline get rAF-driven progress → only CSS custom-property writes
  happen per frame, on one element per active scene.

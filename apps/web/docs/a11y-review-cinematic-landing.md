# Accessibility review (WCAG 2.2 AA): cinematic-landing

- **Date:** 2026-10-02
- **Reviewer:** frontend-engineer (self-review)

**Verdict: no blocking findings.**

| Area | Evidence | Result |
|---|---|---|
| Reduced motion (2.3.3) | E2E: no scene or runtime chunk is requested; every stage is `position: static`; `document.getAnimations()` is empty; key frames are visible (lock check, terminal "Unlocked", 2126); counters show their final values. | Pass |
| Flashing (2.3.1) | The fastest repeating effect is the hero/key pulse, every 2.4 s (under 1 flash/s). Nothing flashes in the scenes; they follow scroll. | Pass |
| No scroll traps (2.1.2) | Native sticky only, with no wheel/touch listeners. E2E: Page Down reaches the footer on desktop, and phone scrolling reaches the footer. | Pass |
| Focus visible / not obscured (2.4.7, 2.4.11) | E2E tabs into the pinned scenes and waits for smooth focus scrolling: every focused CTA ends up fully below the sticky header and inside the viewport. The focus ring tokens are unchanged (≥ 3:1; Sky Link Blue on dark tiles). | Pass |
| Contrast (1.4.3) | Scene text sits in its own column, never over the visuals. New pairs: eyebrow `#0066cc` on white (5.57) and `#2997ff` on tiles (≥ 4.94); stat labels `#6e6e73` on parchment (4.66); the year counter `#2997ff` on tile-1 (4.94; decorative and `aria-hidden`). Axe with contrast runs on every scene mid-scrub and at phone width: 0 violations. Lighthouse accessibility scores 100. | Pass |
| Link decoration (1.4.1) | Inline body links are always underlined (E2E). Chrome links and pills never underline; nav hover uses opacity. | Pass |
| Keyboard (2.1.1) | Landing Tab reaches "Open the app" and every footer link with a visible ring (`05-landing`). | Pass |
| Name and structure (1.3.1, 4.1.2) | One `h1`. Per-word spans carry an `aria-label` with the full sentence, so it is announced once. Each scene has an `h2`; every SVG is `aria-hidden` with its meaning in the text. | Pass |
| Reflow (1.4.10) | No horizontal scroll at 320px (E2E). Scenes stack and unpin at ≤ 640px. | Pass |
| Target size (2.5.8) | Pills and nav targets are ≥ 44px; axe `target-size` passes. | Pass |

## Advisory

- Manual screen-reader passes (NVDA, JAWS, platform readers) over the long page are recommended before launch.

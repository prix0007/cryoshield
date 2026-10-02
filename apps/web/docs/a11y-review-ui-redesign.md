# Accessibility review (WCAG 2.2 AA): redesign-landing-and-app-ui

- **Date:** 2026-10-02
- **Reviewer:** frontend-engineer (self-review)

**Verdict: no blocking findings. Axe (WCAG 2.2 A/AA) reports zero violations in E2E.**

| Area | Evidence | Result |
|---|---|---|
| Contrast (1.4.3, 1.4.11) | `test/ui/tokens.test.ts` computes every declared text pair (≥ 4.5:1) and boundary pair (≥ 3:1) in the light and dark themes and on the landing tiles. AA deviations from the guide are recorded in design.md D6: muted ink `#6e6e73`, input border `#86868b`, focus `#2997ff` on dark. Axe in E2E with contrast enabled covers the landing page at 1280/375, every app screen in light, and app home + error in dark. | Pass |
| Use of colour (1.4.1) | Errors carry an icon, a text title and `role="alert"`. Over-capacity adds a "!" prefix and `aria-invalid`. Disabled buttons use a dashed outline as well as muted text. | Pass |
| Focus visible (2.4.7) | 2px focus rings come from tokens. The landing E2E Tabs through the whole page and asserts an outline of ≥ 2px on every focused element. | Pass |
| Focus not obscured (2.4.11) | `scroll-padding-top/bottom` and `useFocusClearOfActionBar`. The E2E tabs through a 4-secret editor on a 390×600 viewport and asserts that no focused element overlaps the sticky bar or the sticky header. Below 500px tall, the bar becomes static. | Pass (fixed during review: textarea was partly under the bar) |
| Target size (2.5.8) | The E2E requires ≥ 44×44 for every visible button, input, summary and standalone link on every app screen. Axe `target-size` passes on the landing page. Nav links were found to be 18px tall when `chrome.css` was missing from the app bundle; this was fixed. | Pass (fixed) |
| Keyboard (2.1.1) | Keyboard-only create + unlock (existing E2E). Landing Tab reaches "Open the app" and every footer link. The narrow nav menu is a native `<details>` that opens with Enter and closes with Escape (unit + E2E). | Pass |
| Bypass blocks (2.4.1) | Skip link to `#main` on both pages (unit tests). | Pass |
| Headings / landmarks (1.3.1) | One `h1` per page. Header > nav[aria-label=Site], main, footer. The step headings still receive focus on step change. | Pass |
| Status messages (4.1.3) | The ceremony panel keeps `role=status` with `aria-live=assertive` and adds the "Touch your key" label. Errors use `role=alert`. The meter is polite. | Pass |
| Reduced motion (2.3.3) | No Motion chunk is loaded. The hero and key pulses are off, and the press scale is off. Graphics show their final state (E2E). No animation flashes. | Pass |
| Reflow (1.4.10) | At 320px there is no horizontal scroll on `/` or `/app/` (E2E). | Pass |
| Non-text content (1.1.1) | Every landing SVG is `aria-hidden`, and its meaning is stated in the adjacent text. The emoji key glyph was replaced by an `aria-hidden` SVG. | Pass |

## Advisory

- Manual screen-reader passes (NVDA, JAWS and the built-in platform readers) and a Windows high-contrast check are recommended before mainnet. They are
  not automatable here.

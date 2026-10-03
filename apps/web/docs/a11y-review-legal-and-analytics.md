# Accessibility review (WCAG 2.2 AA): legal pages, acknowledgement, opener guard, write-failure details

- **Date:** 2026-10-03
- **Reviewer:** frontend-engineer

**Verdict: no blocking findings. Axe (WCAG 2.2 A/AA) reports zero violations** on `/privacy`, `/terms` and `/cookies`
(`08-legal`), on every app screen including the acknowledgement step (`30-a11y`, light and dark), and on the landing
page (`05-landing`, `07-scenes`).

| Area | Evidence | Result |
|---|---|---|
| Structure (1.3.1) | Each legal page has one `h1`, `h2` sections, landmarks (header/nav, main, footer) and a skip link. The storage inventory is a real table with `scope` on its headers. The acknowledgement is a `fieldset` with a `legend` and labelled checkboxes. | Pass |
| Keyboard (2.1.1) | The keyboard-only create flow ticks both checkboxes with Tab + Space (`30-a11y`). The Details disclosure on write failures is a native `<details>`/`<summary>`. | Pass |
| Status messages (4.1.3) | The acknowledgement hint is `aria-live="polite"`. While Save is disabled it is described by the hint, which explains why (the under-18 path). Error notices remain `role="alert"`. | Pass |
| Target size (2.5.8) | Checkboxes are activated by their 44px label row (the E2E measures the label). Footer links and the Details summary are ≥ 44×44. | Pass (fixed: the app footer's "Terms" link was 37px wide) |
| Focus not obscured (2.4.11) | The sticky-bar check now counts only real overlaps. Footer links below the bar are no longer false positives, and genuinely covered fields are still scrolled clear. | Pass |
| Contrast (1.4.3) | The legal pages use existing tokens. The draft banner uses error ink on white (6.04:1). Placeholders are ink on parchment. Footer links are muted ink 48 on parchment (4.66:1). | Pass |
| Language | Plain-language summaries ("In short") lead each policy. The acknowledgement lists the public fields in words, not jargon. | Pass |

## Advisory

- Screen-reader passes over the long policy pages are recommended. The table on `/cookies` is wide on phones; it
  scrolls horizontally inside its own container, so the page itself still reflows at 320px.

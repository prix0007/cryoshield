# Accessibility note: landing-only-you-can-read

- **Date:** 2026-10-04
- **Reviewer:** frontend-engineer

**Verdict: no blocking findings.**

- **Table semantics:** a real `<table>` with a `<caption>` ("How CryoShield compares with typical cloud storage"),
  `<th scope="col">` for "Typical cloud storage"/"CryoShield", and `<th scope="row">` for each question. The empty
  top-left cell is a `<td>`. Screen readers announce each answer with its row and column.
- **Meaning without colour:** every answer is text. The hollow and filled dots are `aria-hidden` decoration.
- **Motion:**
  - rows reveal with opacity/translate transitions only, staggered 0.12 s;
  - the table is armed only while it is still below the viewport, so text a reader can already see (or a deep link
    to `#only-you`) is never hidden;
  - with reduced motion, no JS or no IntersectionObserver, nothing is armed (E2E checks opacity 1, no transform and
    zero running animations).
- **Contrast:** ink on parchment (15.46:1) for answers and row headers; muted ink 48 on parchment (4.66:1) for the
  caption, column headers and fine print; Action Blue on parchment (5.11:1) for the "CryoShield" header. Axe with
  contrast is clean at 1280 px and 390 px.
- **Reflow:** at 390 px the table fits (wrapped cells, no horizontal page scroll). It sits in a scroll container as a
  fallback for narrower screens.
- **Honesty (copy guardrails, enforced by the content test):** the fine print about end-to-end encrypted password
  managers follows the table; there is no "stays on your device" wording and no competitor name; the
  testnet/unaudited strip in the hero is unchanged.

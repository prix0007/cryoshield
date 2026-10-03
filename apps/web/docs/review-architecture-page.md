# Security and accessibility notes: add-architecture-page

- **Date:** 2026-10-04
- **Reviewer:** frontend-engineer (self-review)

**Verdict: APPROVED. No open findings.**

## Security

- **No script, no third-party resource:**
  - the page is static HTML from a build-time shell; the only stylesheet is same-origin;
  - the build test scans for `<script`, `style=`, `<style`, `="var(` and off-origin `href`/`src`;
  - E2E confirms every request is same-origin.
- **App CSP, standard headers:** the build and container tests compare the page's meta CSP and header with `/app/`.
  `gen-context` refuses to deploy if it differs.
- **No analytics:** the page is in verify-build's analytics-confinement list (no beacon, origin or token in its HTML
  outside the prose).
- **Values from committed files only:** the chain ID, registry address and deploy block come from
  `contracts/deployments/<chainId>.json` (the same loader that verifies the ABI hash). The RP ID comes from the
  validated build config. An unknown chain fails the build. The freshness test checks the rendered values.
- **Content:** ported from the overwatcher's artifact and `docs/system-design.md`. It now says the repository is
  public. External links carry `rel="noopener noreferrer"`.

## Accessibility

- **Figures:** each SVG is `role="img"` with a descriptive `aria-label`, inside a `<figure>` with a `<figcaption>`.
  Marker ids are unique (`arch-ar1..3`).
- **Wide figures:** they scroll inside `tabindex="0"` containers labelled by their figcaption (axe
  `scrollable-region-focusable`), and the arrow keys scroll them (E2E). At 390 px the page itself never scrolls
  sideways.
- **Light and dark:** the page uses the contrast-tested `--app-*` tokens, so text, lines, the accent and the figure
  tile all switch. The sub-nav and footer get dark overrides on this page. Axe (WCAG 2.2 AA) is clean in both schemes.
- **SVG label contrast:** the artifact's `fill-opacity` .6/.7 labels are raised to 0.8 (8.4:1 on the light tile, 12:1
  on the dark tile).
- **Table:** the reference values use `<th scope="row">`.

# Landing page lab metrics (cinematic-landing 4.3)

These are the measured numbers for the landing page at `/` (spec landing-page, "Landing performance budget").

- **Date:** 2026-10-02
- **Build:** `vite build --mode production`, served by `vite preview` on `http://localhost:4173/`
- **Tool:** Lighthouse 12.8.2 (`npx lighthouse@12.8.2`, not a project dependency), headless Chrome 153, mobile form
  factor, simulated throttling, 3 runs (median reported)

## Fast 3G-class (the Lighthouse mobile default)

The mobile default applies a 562.5 ms request latency, 1.47 Mbps down and a 4× CPU slowdown. That is the same profile
as Chrome DevTools' "Fast 3G" preset, which is now named "Slow 4G".

| Run | Perf | A11y | Best practices | FCP | LCP | CLS | TBT |
|---|---|---|---|---|---|---|---|
| 1 | 100 | 100 | 100 | 938 ms | 938 ms | 0 | 0 ms |
| 2 | 100 | 100 | 100 | 913 ms | 913 ms | 0 | 0 ms |
| 3 | 100 | 100 | 100 | 916 ms | 916 ms | 0 | 0 ms |
| **Median** | **100** | **100** | **100** | **916 ms** | **916 ms (< 2.5 s ✔)** | **0 ✔** | **0 ms** |

The LCP element is the hero lead paragraph. The text is in the HTML, so no JS is on the critical path. The only
render-blocking resources are the two same-origin stylesheets (shared tokens and landing).

## Stress run (4× the default latency)

`--throttling.rttMs=562.5`, which simulates about a 2.1 s request latency:

| Metric | Value |
|---|---|
| LCP | 3399 ms |
| CLS | 0 |
| Score | 84 |

This is far beyond Fast 3G, and it is recorded only to show the headroom. The cost is the HTML plus two CSS
round-trips. Inlining critical CSS would cut it, but the CSP forbids inline styles (`style-src 'self'`), so we keep
the strict CSP.

## Frame rate while scrolling every scene

The frame rate was measured with a Playwright rAF frame-interval probe at 1440×900, wheel-scrolling the whole page:

| CPU | Mean fps | Median frame | p95 frame | p99 frame | Frames > 33 ms |
|---|---|---|---|---|---|
| 1× | 60.0 | 16.7 ms | 16.8 ms | 16.8 ms | 0 |
| 4× slowdown (stand-in for a mid-range laptop) | 60.0 | 16.7 ms | 16.7 ms | 16.8 ms | 0 |

Scenes animate only `transform`, `opacity` and SVG stroke offsets from one CSS variable per active stage.

## JS budget (verify-build, gzip)

| Part | Size | Budget |
|---|---|---|
| Initial (landing entry + preload helper) | 2.11 KB | ≤ 15 KB |
| Largest lazy chunk (scene runtime incl. Motion `scroll`) | 3.71 KB | ≤ 40 KB |
| Whole landing graph | 6.60 KB | ≤ 120 KB |

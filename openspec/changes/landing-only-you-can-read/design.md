# Design

## Context

The landing page's light/dark rhythm in the middle is: stored (dark) → lose (dark-2) → survives (light). A light tile
between stored and lose restores the alternation. "Only your keys can open it" is currently one sentence in the tap
scene. It stays there; the new tile expands on it.

## Decisions

- **D1. A plain tile, not a pinned scene.** A table is reading content: pinning it would trap the reader. The tile
  uses the existing `tile tile-parchment` grammar, with the headline in `tile-title` and the body in `tile-lead`.
- **D2. A real table.**
  - `<caption>` gives the purpose; `<th scope="col">` for the two columns; `<th scope="row">` for each question.
  - Answers are text. The check/cross glyphs are `aria-hidden`, so meaning never depends on them.
  - On phones the table keeps two answer columns and wraps text. The tile itself never overflows (tested at 390 px).
- **D3. Row-by-row reveal.**
  - `boot.ts` adds `.armed` to `#only-you table` when motion is allowed and IntersectionObserver exists. When the
    table is 40% visible it adds `.in`.
  - CSS staggers `opacity`/`transform` per row with `transition-delay`.
  - With no JS, reduced motion or a failure, `.armed` is never set, so the rows are static and visible.
  - Cost: a few hundred bytes in the existing initial chunk, well inside the 15 KB budget.
- **D4. Copy guardrails as tests.**
  - The content test asserts the fine print right after the table.
  - It asserts no "stays on/never leaves your device".
  - It asserts no competitor names (a denylist of well-known cloud storage and password-manager brands).
  - The existing honesty tests keep the testnet/unaudited strip.

## Risks / Trade-offs

- **[The comparison generalises "typical cloud storage"]** → the fine print acknowledges end-to-end encrypted password
  managers. Row 1 says the provider "holds or can reset the keys", which is true for typical consumer cloud storage.

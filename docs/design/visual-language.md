# CryoShield visual language (reference guide)

> Provided by the founder on 2026-10-02 as the design guide for the landing page and the app.
> It is an analysis of Apple's web design language. We adopt its **grammar**: tokens, spacing, type scale, tile rhythm, single accent, motion restraint.
> We do **not** adopt Apple's identity. No Apple logos, product names, imagery, or copy.
> Where the guide says "product photography", CryoShield uses **motion graphics** of its own concepts: security keys, the vault, the chain, and the Arweave copy.
>
> **Motion and assets (founder, 2026-10-02):** third-party web-motion libraries and online animation assets are allowed. Security rules, because the landing page shares an origin with the vault app:
> - **Libraries** must be pinned npm packages, bundled at build time (e.g. Motion, GSAP). No runtime CDN scripts.
> - **Downloaded assets** (e.g. Lottie or SVG animations) must be self-hosted under `'self'` and need a license that allows commercial use. Record each asset's source URL and license in `docs/design/ASSETS.md`.
> - **CSP is unchanged:** no `unsafe-eval`, no `unsafe-inline`, Trusted Types `'none'`. Any library that needs eval, `innerHTML` or WASM is rejected (or used via a CSP-compatible renderer).
> - **Motion** respects `prefers-reduced-motion` and never delays or obscures a security-key ceremony.
>
> **Fonts:** the app may only load first-party assets (CSP `font-src 'self'`). Use the `system-ui, -apple-system, BlinkMacSystemFont` stack first, with a **self-hosted Inter** fallback. SF Pro font files must never be bundled.

## Overview

The site presents **the subject framed by near-invisible UI**. Every page is a stack of edge-to-edge "tiles" that alternate between light and dark canvases. Each tile centres on a hero headline, a one-line tagline, two tiny blue pill CTAs, and a crisp visual. Nothing competes with the subject. Typography is confident but quiet. Colour is pure white, an off-white parchment, or a near-black tile. Interactive elements use a single, quiet blue.

Density is very low. Each tile fills roughly one viewport, and there is no decorative chrome: no borders, gradients, decorative frames, or shadows on headlines. Elevation appears only when a visual rests on a surface, as a single soft `rgba(0, 0, 0, 0.22) 3px 5px 30px` drop.

Utility surfaces keep the same chassis: a tight grid of white utility cards at `{rounded.lg}` (18px) radius with a thin border, plus a persistent thin sub-nav strip.

**Key characteristics:**
- The subject comes first; the UI recedes.
- Full-bleed tiles alternate white/parchment ↔ near-black, and the colour change itself is the section divider.
- One blue accent (`{colors.primary}` #0066cc) carries every interactive element. There is no second brand colour.
- Two button grammars: tiny blue pill CTAs (`{rounded.pill}`) and compact utility rectangles (`{rounded.sm}`).
- A display and text font pair, with negative letter-spacing at display sizes ("tight" headlines).
- Exactly one drop-shadow, used only for a visual resting on a surface.
- A tight two-row nav: a slim global nav, plus a frosted sub-nav with a persistent right-aligned primary CTA.
- Section rhythm: light hero → dark tile → light utility tile → dark tile → parchment footer.

## Colors

### Brand & Accent
- **Action Blue** (`{colors.primary}` #0066cc): every link, every pill CTA, and the focus-ring root. Press state is `transform: scale(0.95)`, not a hex change.
- **Focus Blue** (`{colors.primary-focus}` #0071e3): the keyboard focus ring, `outline: 2px solid`.
- **Sky Link Blue** (`{colors.primary-on-dark}` #2997ff): links and callouts on dark surfaces only.

### Surface
- **Pure White** (`{colors.canvas}` #ffffff): the dominant canvas.
- **Parchment** (`{colors.canvas-parchment}` #f5f5f7): alternating light tiles and the footer.
- **Pearl Button** (`{colors.surface-pearl}` #fafafc): fill for secondary "ghost" buttons.
- **Near-Black Tile 1/2/3** (`{colors.surface-tile-1}` #272729, `-2` #2a2a2c, `-3` #252527): dark tiles, with micro-steps between adjacent dark tiles.
- **Pure Black** (`{colors.surface-black}` #000000): the global nav bar and true void.
- **Translucent Chip Gray** (`{colors.surface-chip-translucent}` #d2d2d7): applied at ~64% alpha for circular controls over visuals.

### Text
- **Ink** (`{colors.ink}` #1d1d1f): all text on light surfaces.
- **Body On Dark** (`{colors.body-on-dark}` #ffffff): text on dark tiles and the nav.
- **Body Muted** (`{colors.body-muted}` #cccccc): secondary copy on dark tiles.
- **Ink Muted 80** (`{colors.ink-muted-80}` #333333): text on Pearl buttons.
- **Ink Muted 48** (`{colors.ink-muted-48}` #7a7a7a): disabled text and fine print.

### Hairlines
- **Divider Soft** (`{colors.divider-soft}` #f0f0f0, often `rgba(0,0,0,0.04)`): the ring on secondary buttons.
- **Hairline** (`{colors.hairline}` #e0e0e0): 1px borders on utility cards and chips.

### No decorative gradients
There are zero gradient tokens. Depth comes from the visuals themselves.

## Typography

- **Display:** `system-ui, -apple-system, BlinkMacSystemFont, "Inter", sans-serif` (sizes ≥ 19px).
- **Text:** same stack (sizes below 20px).

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|
| `{typography.hero-display}` | 56px | 600 | 1.07 | -0.28px | Hero headline |
| `{typography.display-lg}` | 40px | 600 | 1.10 | 0 | Tile headlines |
| `{typography.display-md}` | 34px | 600 | 1.47 | -0.374px | Section heads |
| `{typography.lead}` | 28px | 400 | 1.14 | 0.196px | Tile subcopy |
| `{typography.lead-airy}` | 24px | 300 | 1.5 | 0 | Airy lead paragraphs |
| `{typography.tagline}` | 21px | 600 | 1.19 | 0.231px | Tagline; sub-nav name |
| `{typography.body-strong}` | 17px | 600 | 1.24 | -0.374px | Strong inline |
| `{typography.body}` | 17px | 400 | 1.47 | -0.374px | Paragraphs |
| `{typography.dense-link}` | 17px | 400 | 2.41 | 0 | Footer link lists |
| `{typography.caption}` | 14px | 400 | 1.43 | -0.224px | Captions, button text |
| `{typography.caption-strong}` | 14px | 600 | 1.29 | -0.224px | Emphasized captions |
| `{typography.button-large}` | 18px | 300 | 1.0 | 0 | Hero CTAs |
| `{typography.button-utility}` | 14px | 400 | 1.29 | -0.224px | Utility/nav buttons |
| `{typography.fine-print}` | 12px | 400 | 1.0 | -0.12px | Fine print, footer |
| `{typography.micro-legal}` | 10px | 400 | 1.3 | -0.08px | Micro legal |
| `{typography.nav-link}` | 12px | 400 | 1.0 | -0.12px | Global nav items |

**Principles:**
- **Tracking:** negative tracking at 17px and up; none at 12px and below.
- **Body size:** body copy is 17px.
- **Weights:** 300, 400, 600 and 700 only; weight 500 is absent. Headlines use 600.
- **Line height:** display 1.07–1.19; body 1.47 (1.44 with Inter); footer link stacks 2.41.
- **Inter fallback:** use `font-feature-settings: "ss03"` and an extra -0.01em of tracking at display sizes.

## Layout

- **Spacing:** the base unit is 8px. Tokens: `{spacing.xxs}` 4 · `{spacing.xs}` 8 · `{spacing.sm}` 12 · `{spacing.md}` 17 · `{spacing.lg}` 24 · `{spacing.xl}` 32 · `{spacing.xxl}` 48 · `{spacing.section}` 80.
- **Tiles:** 80px vertical padding, stacked with 0 gap; the colour change is the divider.
- **Cards:** 24px padding.
- **Buttons:** 8–11px vertical padding, 15–22px horizontal.
- **Content width:** ~980px for text-heavy sections, ~1440px for grids, full-bleed for tiles.
- **Grid gutters:** 20–24px.
- **Whitespace:** at least 64px of air above a tile headline and 48–64px below; at least 40px between a visual and the nearest content. The footer is the only deliberately dense area.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| Flat | No shadow, no border | Tiles, nav, footer |
| Soft hairline | 1px `rgba(0,0,0,0.08)` | Utility cards, sub-nav separator |
| Backdrop blur | `saturate(180%) blur(20px)` on Parchment at 80% | Sub-nav, floating sticky bar |
| Subject shadow | `rgba(0,0,0,0.22) 3px 5px 30px 0` | Visuals resting on a surface ONLY |

## Shapes

| Token | Value | Use |
|---|---|---|
| `{rounded.none}` | 0 | Full-bleed tiles |
| `{rounded.xs}` | 5px | Rare subtle chips |
| `{rounded.sm}` | 8px | Dark utility buttons, inline card imagery |
| `{rounded.md}` | 11px | Pearl capsule buttons |
| `{rounded.lg}` | 18px | Utility cards |
| `{rounded.pill}` | 9999px | Primary CTAs, chips, search input |
| `{rounded.full}` | 50% | Circular controls |

## Components

- **global-nav:** black, 44px high, `{typography.nav-link}` items about 20px apart, with a right-aligned cluster. Collapses to a hamburger at ≤ 833px.
- **sub-nav-frosted:** sticky below the global nav, 52px high, Parchment at 80% with blur. The surface name is on the left in `{typography.tagline}`, and the links plus a primary pill CTA are on the right.
- **button-primary:** Action Blue fill and white text, `{typography.body}`, pill shape, padding 11×22. Active: `scale(0.95)`. Focus: a 2px Focus Blue outline.
- **button-secondary-pill:** transparent, with blue text and a 1px blue border, pill shape, padding 11×22.
- **button-dark-utility:** Ink fill and white text, `{typography.button-utility}`, `{rounded.sm}`, padding 8×15, active `scale(0.95)`.
- **button-pearl-capsule:** Pearl fill, Ink Muted 80 text, `{typography.caption}`, a 3px Divider Soft ring, `{rounded.md}`, padding 8×14.
- **button-store-hero:** like button-primary, but `{typography.button-large}` with padding 14×28.
- **button-icon-circular:** 44×44, translucent chip at 64%, `{rounded.full}`.
- **text-link / text-link-on-dark:** Action Blue on light surfaces; Sky Link Blue on dark.
- **product-tile-light / -parchment / -dark / -dark-2 / -dark-3:** full-bleed, 80px vertical padding, centred stack: headline (`display-lg`) → tagline (`lead`) → two pill CTAs → the visual, resting on the surface with the subject shadow. On dark tiles, Action Blue pills still work and inline links use Sky Link Blue.
- **utility-card:** white, 1px Hairline, `{rounded.lg}`, 24px padding. Name in `body-strong`, detail in `body`, and a text-link.
- **option-chip / -selected:** pill, white, `caption`, padding 12×16. Selected: a 2px Focus Blue border.
- **floating-sticky-bar:** bottom of the viewport, Parchment at 80% with blur, 64px high, padding 12×32. Status on the left, primary pill on the right.
- **search-input / text inputs:** white, `body` text, 1px `rgba(0,0,0,0.08)` border, pill shape, padding 12×20, 44px high.
- **footer:** Parchment, Ink Muted 80 text, links in `dense-link`, headings in `caption-strong`, a legal row in `fine-print` with Ink Muted 48, 64px vertical padding.

## Do / Don't

**Do:**
- Use one accent for every interactive element.
- Use tight display tracking.
- Set body text at 17px.
- Alternate light and dark tiles.
- Use the pill shape for actions.
- Use the subject shadow only on resting visuals.
- Use `scale(0.95)` as the press state everywhere.
- Use a true-black nav.

**Don't:**
- Don't add a second accent colour.
- Don't put shadows on cards, buttons or text.
- Don't use decorative gradients.
- Don't use weight 500.
- Don't round full-bleed tiles.
- Don't set body line-height below 1.47.
- Don't mix radius grammars.
- Don't use Sky Link Blue on light surfaces.

## Responsive

| Name | Width | Changes |
|---|---|---|
| Small phone | ≤ 419px | Single column; hero 28px; tile padding 48px |
| Phone | 420–640px | Single column; hero 34px; visuals at 80% width |
| Large phone | 641–735px | Tile padding 48px |
| Tablet portrait | 736–833px | Global nav → hamburger |
| Tablet landscape | 834–1023px | 3-col → 2-col grids |
| Small desktop | 1024–1068px | Hero 40px |
| Desktop | 1069–1440px | Full layout |
| Wide | ≥ 1441px | Content locks at 1440px |

- **Touch targets:** at least 44×44.
- **Hero type:** 56 → 40 (at 1068px) → 34 (at 640px) → 28 (at 419px).
- **Assets:** lazy-load below the fold; eager above it.

## Known gaps (fill these for CryoShield)

The source guide has no form validation, error, or empty states, and no dark-mode utility cards. CryoShield must define these (error states matter for key ceremonies), staying within the same tokens: one accent, no new colours except a functional error ink, which needs an explicit decision.

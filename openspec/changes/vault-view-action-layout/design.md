# Design

## D1. Structure (view mode only)

```
[        Edit secrets        ]     floating bar (sticky), one primary button, hidden when read-only
MANAGE VAULT                       h2, caption size, uppercase via CSS (the text node stays "Manage vault")
  Rename or archive          ›     <ul> of <li><button>; hidden when read-only
  Add a key                  ›     hidden when read-only
  Details & backup file      ›     always shown
[ All vaults (N) ]                 plain .actions row (not sticky), only with the vault list
```

- **DOM order = keyboard order:** Edit secrets, the rows, All vaults, then "Where your vault is stored".
- **Rows are built from one array** (mode, label), filtered by read-only. If the array is empty the heading and list
  are not rendered. Today Details is always shown, so the section always renders; the guard costs a few bytes and keeps
  the rule true if a row is gated later.
- **Behaviour is unchanged:** Rename or archive and Add a key clear the status line and the save checklist; Details
  clears the checklist only (as before).

## D2. Sticky bar

The design guide's floating-sticky-bar carries a step's primary action, so it stays, now with one button
(`--bar-rows` stays 1 on phones; `fix-floating-bar-focus-obscured` D2 holds unchanged). The Manage list and the
navigation row scroll with the content: they come after the bar in the DOM, so when they have focus the bar sits at
its natural position above them and cannot cover them. The `focusin` nudge (`useFocusClearOfActionBar`) still
measures the only `.action-bar` on the screen. A read-only vault has no bar at all.

## D3. Visual language

- **Inset grouped list:** surface card (`--app-surface`, 1px `--app-hairline`, `--radius-lg`), rows separated by a
  hairline inset by `--space-lg` from the left (a `::before` on `li + li`, so the full row stays the hit target).
- **Rows:** full width, at least `--target` (44px) high, label in the accent (`--app-link`, the guide's single
  interactive colour), chevron in `--app-muted`. The chevron reuses `.disclosure-chevron` (CSS borders), aria-hidden.
- **Focus:** the 2px `--app-focus` ring is drawn inside the row (negative offset) so the list's rounded clip never hides it.
- **Motion:** rows are `Btn` too (the app-motion rule: every button presses to 0.95 through Motion).
  No new motion.
- **Dark mode:** only app tokens are used, which already switch under `prefers-color-scheme: dark`.
- **CSP:** classes in `global.css`, no inline styles.

## D4. Bundle

The /app initial JS budget had about 220 B of headroom (measured on f2c70e4: e2e 203,673 B, production 203,688 B
against a cap of 203,905 B). The rows are one mapped array and reuse existing classes, so no baseline change is
planned; the measured delta is recorded in tasks 2.1.

## D5. Lock in the header bar (ECC review M3, overwatcher decision, 2026-10-08)

Lock must always be reachable, and the bottom row scrolls away. While a vault is open (the vault screen), a compact
secondary Lock pill sits in the sticky "Your vault" sub-nav, after the Testnet chip (`SubNav` gained an optional
`action`). To avoid two tab stops and two same-named buttons, the bottom row no longer repeats Lock; it holds only
"All vaults (N)" and is omitted when there is no vault list. Other screens keep their own Lock/Back buttons (the vault
list, chunk fallbacks), and the header shows none there. The pill keeps the 44 px target with smaller text.

## D6. Review L1 / L4

The rows are one array with a `writable` flag, filtered for read-only vaults (no `splice`). The list is
`aria-labelledby` its "Manage vault" heading.

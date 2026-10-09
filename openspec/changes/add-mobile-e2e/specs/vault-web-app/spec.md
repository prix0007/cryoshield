# Spec Delta

## ADDED Requirements

### Requirement: Phone viewport support
Every page of the static site (`/`, `/app/`, `/privacy`, `/terms`, `/cookies`, `/architecture`, `/devices`,
`/support`) and every screen of the vault app SHALL be fully usable on a touch phone from 360 CSS px wide:
- the page MUST NOT scroll horizontally (wide tables and figures scroll inside their own container);
- every navigation item, the narrow-screen menu, the theme switch, every footer link, every call to action, every
  disclosure and every vault action MUST be visible, inside the viewport when scrolled to, not covered by another
  element, and operable by tap;
- every interactive target MUST be at least 24×24 CSS px (WCAG 2.2 2.5.8), except inline links in running text and
  targets that meet the spacing exception;
- text MUST NOT overflow or be clipped by its container, and an opened menu or disclosure MUST fit the viewport and
  close by tap.

The E2E suite SHALL prove this with a Chromium phone emulation (touch, coarse pointer) at 412 px and 360 px wide.

#### Scenario: Every page on a phone
- **WHEN** the mobile E2E spec opens each public page and the app home at 360 px and 412 px wide with touch
- **THEN** none scrolls horizontally, every link, menu, theme switch and call to action passes a tap check inside the
  viewport, and no target is smaller than 24×24 px

#### Scenario: The vault flow by tap
- **WHEN** a user on a phone creates a vault with two keys, unlocks it, shows and copies a secret, opens Where your
  vault is stored, All vaults, Details & backup file and Rename or archive, adds a third key and locks, using taps
  only
- **THEN** every step completes, every screen passes the same no-scroll, tap and target-size checks, and the third
  key unlocks the vault

#### Scenario: Narrow menu
- **WHEN** a visitor taps the menu button on a phone
- **THEN** the menu opens inside the viewport, each item is tappable, and tapping the button again closes it

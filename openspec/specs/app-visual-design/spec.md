# app-visual-design Specification

## Purpose
Defines the vault app's visual system: tokens, navigation, controls, and the error, validation, empty and
security-key ceremony states. The app follows the founder's visual language and stays accessible (WCAG 2.2 AA),
without changing any vault behaviour.

## Requirements

### Requirement: Design tokens as custom properties
All colours, radii, spacing, type sizes and the single subject shadow used by the app and the landing page SHALL come
from CSS custom properties defined once, on `:root`, from the visual-language guide. There SHALL be one interactive
accent colour. The only additional hue SHALL be a functional error ink, used only for error and invalid states.

#### Scenario: Single source of tokens
- **WHEN** the stylesheets are scanned
- **THEN** every hex or rgb colour literal outside the token block is absent, and no colour token besides the accent family and the error ink has a hue that differs from neutral grey

### Requirement: Token contrast
Every foreground/background token pair the app uses for text SHALL have a contrast ratio of at least 4.5:1. Large
display text (24px and up, or 18.66px bold and up) SHALL be at least 3:1. Non-text UI boundaries, such as input
borders and focus rings, SHALL be at least 3:1 against their background. This applies in both light and dark themes.

#### Scenario: Contrast table
- **WHEN** the unit test computes WCAG contrast for every declared text pair and UI-boundary pair in both themes
- **THEN** every text pair is ≥ 4.5:1 and every boundary pair is ≥ 3:1

### Requirement: Navigation chrome
The app SHALL show:
- a black global nav, 44px high, with the CryoShield wordmark linking to `/`, a link back to the explainer, and a
  keyboard-operable menu at widths of 833px and below;
- a frosted, sticky sub-nav naming the current surface and showing a "Testnet" chip.

Navigation MUST NOT duplicate the accessible name of any vault action button.

#### Scenario: Nav present and unique names
- **WHEN** any app screen renders
- **THEN** a `navigation` landmark with a link to `/` is present, the sub-nav shows the surface name and "Testnet", and no two buttons on the screen share an accessible name except per-item actions disambiguated by their item label

### Requirement: Buttons and press state
Primary actions SHALL be Action Blue pills with white text. Secondary actions SHALL be outlined pills. Every button
SHALL scale to 0.95 while pressed, unless the user prefers reduced motion. Buttons SHALL be at least 44×44 CSS px.
Disabled buttons SHALL remain identifiable as buttons.

#### Scenario: Pill and press
- **WHEN** a primary button is rendered and pressed
- **THEN** its computed border-radius is the pill radius, its height is ≥ 44px, and its `:active` transform is `scale(0.95)` (none under reduced motion)

### Requirement: Typography
Body text SHALL be 17px with a line height of at least 1.47, using the system UI font stack first and a self-hosted
Inter as the fallback. Font weight 500 MUST NOT be used. Fonts MUST be served from the site's own origin.

#### Scenario: Body size and font source
- **WHEN** an app screen renders
- **THEN** the computed body font-size is 17px, the font-family starts with `system-ui`, and every `@font-face` source is a same-origin URL

### Requirement: Utility cards and secret list
Each step's content and each stored secret SHALL be presented on a utility card: the surface colour, a 1px hairline,
the 18px radius and 24px padding. Cards MUST NOT carry a drop shadow.

#### Scenario: Secret cards
- **WHEN** an unlocked vault with two secrets is shown
- **THEN** each secret is a card with its label as a heading and its Show and Copy actions

### Requirement: Floating sticky action bar
Each step's main actions SHALL be in a floating bar that stays visible at the bottom of the viewport while the step's
content scrolls. The bar SHALL keep the actions in document order, so the keyboard order does not change. A focused
element MUST NOT be hidden behind the bar.

#### Scenario: Sticky bar does not obscure focus
- **WHEN** the user tabs through a long secrets editor on a short viewport
- **THEN** every focused field is fully visible above the sticky bar

### Requirement: Error, validation and empty states
Errors SHALL be shown in an alert region with the error ink and an error icon, together with text that says what
happened and what to do. Colour MUST NOT be the only signal. Invalid input SHALL be marked `aria-invalid` with the
message linked by `aria-describedby`. An empty vault or editor SHALL show a plain empty-state message.

#### Scenario: Error notice
- **WHEN** any flow sets an error
- **THEN** a `role="alert"` region with an icon, a short title and the existing plain-language message is shown, and it uses the error ink

#### Scenario: Over capacity
- **WHEN** the secrets exceed the vault capacity
- **THEN** the meter text uses the error ink, the secret field is `aria-invalid="true"` and described by the meter, and Save is disabled

#### Scenario: Empty vault
- **WHEN** an unlocked vault has no secrets
- **THEN** an empty-state card says the vault has no secrets yet and offers "Edit secrets"

### Requirement: Key ceremony states
Security-key interactions SHALL use one ceremony panel with distinct, labelled states:
- touch your key (waiting);
- wrong key;
- PIN needed;
- key not supported;
- cancelled.

The waiting state SHALL be announced politely and SHALL animate only when motion is allowed. Motion MUST NOT delay or
obscure the browser's security-key prompt.

#### Scenario: Waiting
- **WHEN** a flow is waiting for a key touch
- **THEN** the ceremony panel shows the existing prompt text with the "Touch your key" state label in a live status region

#### Scenario: Error kinds
- **WHEN** the key error is WRONG_KEY or DUPLICATE_KEY, USER_NOT_VERIFIED, PRF_UNSUPPORTED_KEY or WRONG_ALGORITHM, or CANCELLED
- **THEN** the error notice title is "Wrong key", "PIN needed", "Key not supported" or "Request cancelled" respectively, followed by the existing message

### Requirement: Behaviour unchanged by the restyle
The restyle MUST NOT change any vault behaviour, including:
- user verification;
- PRF handling;
- zeroization of key material;
- the idle wipe and auto-lock;
- the chain guard;
- clipboard clearing;
- the user-facing messages of existing flows.

#### Scenario: Existing suites
- **WHEN** the existing unit, integration and E2E suites run against the restyled app at `/app/`
- **THEN** they pass with only route and selector updates, and no assertion about behaviour is weakened

### Requirement: App accessibility
Every app screen SHALL pass an axe WCAG 2.2 A/AA audit. Every interactive element SHALL show a visible focus ring with
at least 3:1 contrast. Every button, input and standalone link SHALL be at least 44×44 CSS px; links inside running text are exempt (WCAG 2.5.8 inline exception).

#### Scenario: Audit every screen
- **WHEN** the E2E accessibility spec walks home, create, unlock, vault, edit, add key and details by keyboard only
- **THEN** axe reports no violations and no visible button, input or standalone link is smaller than 44×44

## MODIFIED Requirements

### Requirement: Token contrast
Every foreground/background token pair the app uses for text SHALL have a contrast ratio of at least 4.5:1. Large
display text (24px and up, or 18.66px bold and up) SHALL be at least 3:1. Non-text UI boundaries, such as input
borders and focus rings, SHALL be at least 3:1 against their background. This applies in both light and dark themes,
whether the theme comes from the device (System) or is forced by the theme switch, and to the page tokens
(`--page-*`) that theme the landing and legal-layout pages. The dark token values for a forced Dark theme and for
System on a dark device SHALL be identical.

#### Scenario: Contrast table
- **WHEN** the unit test computes WCAG contrast for every declared text pair and UI-boundary pair in both themes
- **THEN** every text pair is ≥ 4.5:1 and every boundary pair is ≥ 3:1

#### Scenario: One dark palette
- **WHEN** the unit test compares the `:root[data-theme="dark"]` block with the `prefers-color-scheme: dark` block
- **THEN** both declare the same custom properties with the same values

### Requirement: Navigation chrome
The app SHALL show:
- a black global nav, 44px high, with the CryoShield wordmark linking to `/`, a link back to the explainer, the theme
  switch (System, Light, Dark), and a keyboard-operable menu at widths of 833px and below;
- a frosted, sticky sub-nav naming the current surface and showing a "Testnet" chip.

Navigation MUST NOT duplicate the accessible name of any vault action button.

#### Scenario: Nav present and unique names
- **WHEN** any app screen renders
- **THEN** a `navigation` landmark with a link to `/` and a "Theme" combobox is present, the sub-nav shows the surface name and "Testnet", and no two buttons on the screen share an accessible name except per-item actions disambiguated by their item label

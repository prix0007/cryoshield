# Spec Delta

## ADDED Requirements

### Requirement: Motion never moves a focused field
No animation in the vault app SHALL change layout after it starts: entering and leaving content SHALL animate only paint properties (opacity, transform, clip-path) and take its final size immediately, so a field the browser has scrolled clear of the floating action bar on focus stays clear. `scroll-padding-bottom` SHALL equal the floating action bar's real footprint, including stacked buttons on phones, so focus scrolling keeps the focused element clear of the bar with and without reduced motion (WCAG 2.4.11).

#### Scenario: Fast keyboard after adding a row
- **WHEN** a user adds a secret row and, in the same moment, focuses the control below it
- **THEN** that control's position does not change afterwards, and it is not under the floating action bar

#### Scenario: Stacked buttons on a phone
- **WHEN** the vault editor (Save and Cancel stacked) is used at 390×600 and the user tabs through every field
- **THEN** no focused field is under the action bar or the header, measured both immediately and once animations have settled

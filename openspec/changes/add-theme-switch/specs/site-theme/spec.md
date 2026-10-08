# Spec Delta

## Purpose

Defines the site-wide colour theme: a System / Light / Dark choice reachable on every page, applied before first paint
under the strict CSP, remembered in one fail-safe browser key, and accessible (WCAG 2.2 AA) in both themes.

## ADDED Requirements

### Requirement: Theme choice on every page
Every page (`/`, `/app/`, `/architecture`, `/devices`, `/support`, `/privacy`, `/terms`, `/cookies`) SHALL offer a theme
switch in its global nav with exactly three choices: System, Light and Dark. System SHALL be the default. The switch
SHALL be a native `<select>` with the accessible name "Theme", at least 44 CSS px tall, operable by keyboard, and it
MUST NOT cause horizontal scrolling at 320 CSS px. On pages without other JavaScript, the switch SHALL be hidden until
the theme script runs, so it never appears without working.

#### Scenario: Switch present and labelled
- **WHEN** any page is loaded at 390 px and at 1280 px
- **THEN** a combobox named "Theme" with the options System, Light and Dark is visible in the global nav, it is at least 44 px tall, and the page has no horizontal scroll

#### Scenario: Keyboard choice
- **WHEN** a keyboard user focuses the switch and selects Dark
- **THEN** `<html>` gets `data-theme="dark"` and the page turns dark without a reload

### Requirement: Theme applies before first paint
The saved theme SHALL be applied before the page body is parsed, by a same-origin classic script loaded in `<head>`
after the CSP meta tag. It MUST NOT use an inline script, an inline event handler, an inline style or any HTML sink,
and the CSP of every page SHALL stay unchanged. Light and Dark SHALL set `<html data-theme>` to `light` or `dark`;
System SHALL leave the attribute unset so the `prefers-color-scheme` media query decides. `color-scheme` SHALL follow
the effective theme so native controls match.

#### Scenario: Restored before paint
- **WHEN** a visitor who chose Dark loads any page
- **THEN** `data-theme="dark"` is already set on `<html>` when the first element of `<body>` is parsed

#### Scenario: System follows the device
- **WHEN** the choice is System and the device switches between light and dark
- **THEN** the page follows the device scheme, and `data-theme` stays unset

#### Scenario: Forced theme beats the device
- **WHEN** the choice is Light on a device in dark mode, or Dark on a device in light mode
- **THEN** the page renders in the chosen theme

### Requirement: Theme preference storage
The choice SHALL be remembered in one browser key, `localStorage["cryoshield-theme"]`, holding only `light` or `dark`.
Choosing System SHALL delete the key. Nothing SHALL be stored until the visitor chooses Light or Dark. The key MUST NOT
hold an identifier and MUST NOT be sent anywhere. Every storage access SHALL be wrapped so that a missing, invalid or
throwing storage falls back to System and the page still works. No other code in the shipped build may use browser
storage.

#### Scenario: Persisted and restored
- **WHEN** a visitor chooses Dark on one page and opens another page
- **THEN** `localStorage` holds exactly `cryoshield-theme = dark` and the second page renders dark

#### Scenario: Storage throws
- **WHEN** reading or writing `localStorage` throws (storage disabled or blocked)
- **THEN** the page renders in the System theme, choosing a theme still applies it to the open page, and no error escapes

#### Scenario: Invalid value
- **WHEN** `cryoshield-theme` holds any value other than `light` or `dark`
- **THEN** the page uses System

#### Scenario: Storage confined to the theme script
- **WHEN** `verify-build` scans the shipped JavaScript
- **THEN** `localStorage` appears only in the theme script, and any other storage API, or `localStorage` in any other file, fails the build

### Requirement: Themed pages
Every page SHALL have a light and a dark appearance driven by tokens: the vault app, `/architecture`, the legal-layout
pages and the landing page's light tiles, sub-nav and footer. The landing page's dark story tiles SHALL stay dark in
both themes. Filled primary pills SHALL keep white text on the Action Blue fill in both themes.

#### Scenario: Dark legal page
- **WHEN** `/privacy` is loaded with the Dark choice
- **THEN** its main background is the dark page canvas and its body text is the light page ink

### Requirement: Contrast in both themes
Every themed page SHALL meet WCAG 2.2 AA in both themes: text at least 4.5:1 (3:1 for large text), and UI component
boundaries and focus indicators at least 3:1. An E2E spec SHALL run axe, including the colour-contrast rule, on the
landing page, a legal page, the app home, an open vault, the vault list and the secrets editor, with the theme forced
to Light and to Dark through the switch.

#### Scenario: Axe in both forced themes
- **WHEN** the E2E theme spec audits those screens in forced Light and forced Dark
- **THEN** axe reports no violations

# Accessibility note: add-supported-devices-page (WCAG 2.2 AA)

## Structure
- `/devices` has one h1 ("Supported devices") and h2 sections in order.
- It reuses the legal layout: a skip link, `main#main` and the shared header and footer.
- The heading IDs are stable slugs, so the in-page links ("below", "Why phone and laptop passkeys are refused") land on
  real headings.

## Tables
- The three tables (requirements, keys, browsers) have `<th scope="col">` headers.
- Each sits in the legal `.table-wrap`, so on a 390 px screen the table scrolls inside its own container and the page
  never scrolls sideways (see `devices-phone.png`).

## Status is in text
- "Tested", "Expected to work" and "Not supported" are written out, with bold for emphasis only.
- Nothing is conveyed by colour or icon alone (SC 1.4.1).

## Links
- Link text is descriptive: "Open a device report", "See supported devices" and "Supported devices".
- The error link in the app is an inline text link inside the notice. WCAG 2.5.8 exempts inline links from the
  target-size rule, and the app's 44 px target audit already excludes links inside paragraphs.
- The footer links use the existing 44 px footer link style.

## Contrast and themes
- Light and dark use the legal page tokens.
- axe passes on `/devices` in light and dark, and on the app's key-error state with the link.

## Reduced motion
The page has no script and no animation.

## Follow-up
The app's "Browser not supported" notice links `/devices`, but it can't yet say which browser was detected. That's not
needed for AA.

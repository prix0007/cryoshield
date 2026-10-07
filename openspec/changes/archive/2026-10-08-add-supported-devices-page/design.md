# Design

## Decisions

### D1. One Markdown file, rendered at build
`docs/supported-devices.md` lives at the repository root, next to the other docs, so GitHub renders it and contributors
edit one file.
- **Rendering:** `renderRepoDoc()` passes it through the existing legal renderer (`vite-plugins/legal.ts`), which
  escapes everything and refuses any link scheme other than `https:`, `/`, `#` and `mailto:`.
- **Shell:** `apps/web/devices/index.html` reuses the legal shell, CSS and partials. The renderer supports no nested
  lists, so the document is written within its subset, and the unit test renders it.
- **Links:** they are absolute (`https://cryoshield.app/devices`, GitHub URLs), so they work both on GitHub and on the
  site.

### D2. Route, headers, CSP
`/devices` is served exactly like `/architecture`:
- a Caddy clean-URL rewrite, the no-cache HTML rule and a 404 for anything below it;
- the app CSP (gen-context requires it to equal `/app/`'s meta CSP);
- every security header;
- no script.

verify-build adds it to the required pages and to the analytics-confinement list. The deploy smoke test fetches it.

### D3. Honest statuses
A content test enforces three rules:
- every key and browser row has exactly one of **Tested**, **Expected to work** or **Not supported**;
- "Tested" always carries a date and the tested flow in parentheses;
- the only "Tested" row is the YubiKey 5 create flow, which must state that it ran before credProtect level 3 was
  required and that unlock and recovery aren't confirmed yet.

Browsers are "Expected to work". Our automated tests use Chromium virtual keys, not hardware, and we haven't verified
which browsers pass credProtect through. The page says so.

### D4. Staying in sync with the app
- The page quotes the app's real refusal messages, and a unit test compares them with `S.keyErrors`.
- The "Last reviewed" date must parse and must not be in the future anywhere on Earth (now + 14 h, UTC+14).

### D5. Links from errors
`Notice` adds "See supported devices" to error notices titled "Key not supported" or "Browser not supported", and to
the enrollment-cancel message, which may also mean a key without credProtect.

The link sits inside a paragraph, so it is an inline text link; WCAG 2.5.8 exempts inline links from the target-size
rule.

### D6. Device reports
The issue form is public.
- **Warning:** its first element is the standard bold secrets warning (already enforced for every template), and it
  adds serial numbers, vault IDs and wallet addresses to the list.
- **Confirmation:** a required "no secrets posted" checkbox.
- **"What worked":** only checkboxes for the steps the reporter actually performed.

## Risks / Trade-offs

- **[The page goes stale]** → the "Last reviewed" date, the CI path filter (an edit runs the web tests) and the
  device-report form keep it current. Statuses only move to "Tested" with a date.
- **[The landing guardrail bans Apple names]** → the FAQ names Chrome, Edge and Firefox and links `/devices`, which
  names Safari and iOS factually.

# Spec Delta

## Purpose

A single, honest supported-devices page: one Markdown source in the repository, deployed at `/devices`, linked from
every footer and from the app's key errors.

## ADDED Requirements

### Requirement: Single source rendered at /devices
The supported-devices content SHALL live in `docs/supported-devices.md` and SHALL be rendered at build time into a static page at `/devices` with the legal-pages Markdown renderer (HTML-escaped, link-scheme allowlist). The page SHALL carry the app CSP and every security header, load no script, make no third-party request, include no analytics, and be served with `no-cache`.

#### Scenario: Route served
- **WHEN** `/devices` is requested from the container
- **THEN** it returns 200 with the rendered page, the app CSP and every security header, `/devices/` is 200, and `/devices/x` is 404

### Requirement: Honest statuses
Each key and browser SHALL have exactly one status: Tested (by us, with a date, firmware where known, and the flow tested), Expected to work (meets every requirement on paper, untested), or Not supported. The page SHALL NOT claim testing that has not happened, and SHALL state any pending verification. It SHALL carry a "Last reviewed" date that is valid and not in the future.

#### Scenario: Only real tests claimed
- **WHEN** the content tests read the keys and browsers tables
- **THEN** every row has one allowed status, every "Tested" row has a date and the tested flow, and the only "Tested" row is the YubiKey 5 create flow, marked as run before credProtect level 3 was required, with unlock and recovery pending

### Requirement: Required content
The page SHALL list the key requirements, each with a reason: FIDO2/CTAP 2.1 with hmac-secret (PRF), user verification, credProtect level 3, discoverable credentials (with the free-slot note), ES256/P-256, and a roaming authenticator. It SHALL explain why platform and synced passkeys are refused, give the browsers, the recovery tool's requirements (USB in the single-file binary, NFC via the pyscard extra, the operating systems, Python 3.10+), and how to check a key, quoting the app's refusal messages exactly.

#### Scenario: Messages in sync
- **WHEN** an app refusal message changes
- **THEN** the content test fails until `docs/supported-devices.md` quotes the new text

### Requirement: Device report form
The repository SHALL provide a GitHub issue form for device reports (model, firmware, operating system, browser, connection, what worked). It SHALL open with the bold warning never to post seed phrases, recovery codes, PINs or keys, and SHALL require a no-secrets confirmation.

#### Scenario: Valid form
- **WHEN** the issue-template tests parse `device-report.yml`
- **THEN** it is a valid form with the warning first, the device fields (model, firmware and OS required), and a required confirmation

### Requirement: Linked everywhere
"Supported devices" SHALL be linked from the footer of the landing page, `/app`, every legal page, `/architecture` and `/devices`; from the landing FAQ "What do I need?"; and from the app's key and browser error states ("See supported devices").

#### Scenario: Footer link on every page
- **WHEN** the E2E suite opens `/`, `/app/`, `/privacy`, `/terms`, `/cookies`, `/architecture` and `/devices`
- **THEN** each footer has exactly one "Supported devices" link to `/devices`, and following it opens the page

### Requirement: Accessible page
`/devices` SHALL pass axe (WCAG 2.2 AA) in light and dark mode, with one h1 and an ordered heading structure. Its tables SHALL have column headers and scroll inside their own container on narrow screens.

#### Scenario: axe in both themes
- **WHEN** the E2E suite audits `/devices` with the light and dark colour schemes
- **THEN** axe reports no violations, and there are no CSP or Trusted Types console errors

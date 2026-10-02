# Spec Delta

## Purpose

Defines the only user-facing analytics CryoShield runs: cookieless, identifier-free page-view counting on the public
landing page, with hard guarantees that no analytics code or traffic ever reaches the app routes that handle keys and
secrets.

## ADDED Requirements

### Requirement: Analytics confined to the landing route
Analytics code SHALL be loaded only by the landing document served at `/`. No document, script chunk, or worker served
under `/app` SHALL contain or import analytics code, and no `/app` page SHALL make a network request to the analytics
origin.

#### Scenario: App bundle contains no analytics code
- **WHEN** `verify-build` inspects every file reachable from the `/app` entry
- **THEN** none contains the analytics module marker or the analytics endpoint origin

#### Scenario: No analytics traffic from the app
- **WHEN** an E2E test loads `/app`, creates a vault, unlocks it and navigates within the app
- **THEN** zero requests are made to the analytics origin

#### Scenario: Navigating from landing to app
- **WHEN** a visitor loads `/` (one page view is sent) and then follows the link to `/app`
- **THEN** no further analytics request is made after the `/app` document starts loading

### Requirement: Per-route Content Security Policy
The HTTP CSP for `/` SHALL equal the app CSP except that its `connect-src` additionally lists exactly one analytics
event origin. Every other path, including `/app`, 404 and error responses, SHALL be served the unchanged app CSP.
`script-src` SHALL remain `'self'` on every route.

#### Scenario: Landing CSP
- **WHEN** the container test requests `/`
- **THEN** the CSP `connect-src` contains the analytics origin, and `script-src` is `'self'` only

#### Scenario: App CSP unchanged
- **WHEN** the container test requests `/app`, `/app/`, an unknown path, and a 404
- **THEN** each CSP is byte-identical to the app CSP and does not contain the analytics origin

### Requirement: First-party analytics script
The analytics client SHALL be bundled into the site and served from the site's own origin. No third-party script,
inline script, or tag manager SHALL be loaded, and Trusted Types enforcement SHALL stay on.

#### Scenario: No third-party script
- **WHEN** the landing page loads in the E2E test
- **THEN** every script response comes from the site origin and no CSP violation is reported

### Requirement: Page-view payload without identifiers
Each analytics event SHALL contain only the event name, the site domain, and the constant URL `https://<host>/`.
It SHALL NOT include the query string, fragment, referrer, screen or device data, cookies, storage-derived IDs, user
IDs, wallet or account addresses, vaultIds, or locators. Nothing SHALL be read from the device to build the event.

#### Scenario: Query parameters stripped
- **WHEN** a visitor loads `/?ref=abc&utm_source=x#frag`
- **THEN** the event body's URL is exactly `https://cryoshield.app/` and contains neither `abc`, `utm_source`, nor `frag`

#### Scenario: Referrer not sent
- **WHEN** a visitor arrives at `/` from `https://news.example/item?id=1`
- **THEN** the event body has no referrer field and the request is sent with `Referrer-Policy: no-referrer`

#### Scenario: No storage or cookies
- **WHEN** the landing page has loaded and sent its event
- **THEN** `document.cookie` is empty, localStorage and sessionStorage hold no keys, and the request has no `Cookie` header

### Requirement: Privacy signals honoured
The analytics client SHALL send nothing when `navigator.globalPrivacyControl` is true or `navigator.doNotTrack` is
`"1"`. It SHALL also send nothing on any host other than the production host, and in E2E and development builds.

#### Scenario: GPC set
- **WHEN** the E2E browser sets `navigator.globalPrivacyControl = true` and loads `/`
- **THEN** zero requests are made to the analytics origin

#### Scenario: DNT set
- **WHEN** the E2E browser sets `navigator.doNotTrack = "1"` and loads `/`
- **THEN** zero requests are made to the analytics origin

### Requirement: Analytics failure is invisible
A blocked, failed or slow analytics request SHALL NOT affect rendering, navigation, or console output of the landing
page, and SHALL never be retried more than once.

#### Scenario: Blocked endpoint
- **WHEN** the analytics origin is blocked by the test harness
- **THEN** the landing page renders and the link to `/app` works

### Requirement: Disclosed in the privacy policy
The `/privacy` page SHALL name the analytics vendor, its data location, the exact fields sent, that the vendor sees the
visitor's IP address and user agent in transit, that no cookies are used, how GPC/DNT are honoured, and that `/app`
has no analytics. A test SHALL fail if the vendor origin in the build config is not named on `/privacy`.

#### Scenario: Policy drift check
- **WHEN** the analytics origin in the build config differs from the vendor named on the built `/privacy` page
- **THEN** `verify-build` fails

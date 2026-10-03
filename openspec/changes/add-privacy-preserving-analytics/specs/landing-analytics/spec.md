# Spec Delta

## Purpose

Defines the only user-facing analytics CryoShield runs: Cloudflare Web Analytics in "beacon only" mode on the landing
page, loaded as integrity-pinned, reviewed bytes, with hard guarantees that no analytics code or traffic reaches the
vault app, legal pages, or any visitor who sends GPC or DNT.

## ADDED Requirements

### Requirement: Analytics confined to the landing document
The analytics beacon SHALL be inserted only by the landing document served at `/` and `/index.html`. No document,
script chunk or worker under `/app/`, `/privacy`, `/terms` or `/cookies` SHALL contain or reference the beacon, and
none SHALL make a request to a Cloudflare analytics origin.

#### Scenario: App bundle contains no analytics code
- **WHEN** `verify-build` inspects `app/index.html` and every file reachable from the app entry
- **THEN** none contains `cloudflareinsights`, the beacon file name, or the beacon token

#### Scenario: No analytics traffic from the app
- **WHEN** an E2E test loads `/app/`, creates a vault, unlocks it and updates it
- **THEN** zero requests go to `static.cloudflareinsights.com` or `cloudflareinsights.com`

#### Scenario: Landing to app navigation
- **WHEN** a visitor loads `/` and then follows the link to `/app/`
- **THEN** no analytics request starts after the `/app/` document begins loading

### Requirement: Integrity-pinned beacon
The beacon SHALL load only with an `integrity` attribute (SHA-384) and `crossorigin="anonymous"`, from bytes that a
reviewer has approved and whose hash is committed in the repository. A beacon file whose hash differs SHALL NOT
execute.

#### Scenario: Hash mismatch fails closed
- **WHEN** the served beacon bytes differ from the committed hash
- **THEN** the browser refuses the script, no analytics request is made, and the landing page works normally

#### Scenario: Drift detected
- **WHEN** the weekly drift check finds that Cloudflare's published `beacon.min.js` hash differs from the committed hash
- **THEN** the check fails, prints both hashes, and links the review procedure; nothing is updated automatically

### Requirement: Privacy signals suppress the beacon
When `navigator.globalPrivacyControl` is true or `navigator.doNotTrack` is `"1"`, the landing page SHALL NOT insert
the beacon element at all. The beacon SHALL also not be inserted on any host other than the production host, or in
development and E2E builds.

#### Scenario: GPC set
- **WHEN** the E2E browser sets `navigator.globalPrivacyControl = true` and loads `/`
- **THEN** no beacon script element exists and zero requests go to Cloudflare analytics origins

#### Scenario: DNT set
- **WHEN** the E2E browser sets `navigator.doNotTrack = "1"` and loads `/`
- **THEN** no beacon script element exists and zero requests go to Cloudflare analytics origins

### Requirement: No URL parameters or identifiers sent
Before inserting the beacon, the landing page SHALL remove any query string and fragment from the address with
`history.replaceState`. Beacon configuration SHALL disable single-page-app tracking. No request to an analytics origin
SHALL contain a query string value, a fragment, a cookie, or any CryoShield identifier.

#### Scenario: Query parameters stripped
- **WHEN** a visitor loads `/?ref=abc&utm_source=x#frag`
- **THEN** every captured request body and URL to Cloudflare analytics origins contains neither `abc`, `utm_source` nor `frag`

#### Scenario: No cookies or storage
- **WHEN** the landing page has loaded and the beacon has reported
- **THEN** `document.cookie` is empty, localStorage and sessionStorage hold no keys, the analytics requests carry no `Cookie` header, and no `Set-Cookie` response is received

### Requirement: Landing cannot use WebAuthn
The landing document SHALL be served with a Permissions-Policy that disables `publickey-credentials-get` and
`publickey-credentials-create`, so third-party analytics code on `/` can never start a hardware-key ceremony for the
CryoShield RP ID.

#### Scenario: Ceremony blocked on landing
- **WHEN** an E2E test calls `navigator.credentials.get({ publicKey: … })` on `/`
- **THEN** the call rejects with `NotAllowedError` and no authenticator prompt appears

### Requirement: App refuses a same-origin opener
The vault app SHALL refuse to initialise and show a plain message asking the user to open CryoShield directly when
`window.opener` is non-null, so a script on another same-origin page cannot open and drive the app window.

#### Scenario: Opened from the landing page by script
- **WHEN** a test script on `/` calls `window.open('/app/')`
- **THEN** the opened app shows "Open CryoShield directly" and performs no WebAuthn, bundler or RPC call

### Requirement: Analytics failure is invisible
A blocked, failed, or integrity-rejected beacon SHALL NOT affect rendering, navigation, motion or console output of
the landing page.

#### Scenario: Blocked endpoint
- **WHEN** the analytics origins are blocked by the test harness
- **THEN** the landing page renders, its scenes play, and the link to `/app/` works

### Requirement: Disclosed in the privacy and cookie policies
`/privacy` and `/cookies` SHALL name Cloudflare Web Analytics, its role and data location, the data the beacon sends
(page path, referrer, user agent, performance timings, and IP in transit), that it sets no cookies, that GPC and DNT
suppress it, and that `/app/` has no analytics. A build check SHALL fail if the beacon origin is not named on both.

#### Scenario: Policy drift check
- **WHEN** the analytics origin in the build config is missing from the built `/privacy` or `/cookies` page
- **THEN** `verify-build` fails and names the page

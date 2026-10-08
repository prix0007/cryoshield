# Spec Delta

## MODIFIED Requirements

### Requirement: HTTP security headers
Every response SHALL carry:
- a `Content-Security-Policy` that equals its document's built meta CSP followed by `; frame-ancestors 'none'`,
  derived from the build output and never hand-copied: the landing CSP (`index.html`) on `/` and `/index.html`, and
  the app CSP on every other path, 404 and error responses included, matched on the raw request path (spec
  `landing-page`);
- `X-Frame-Options: DENY`;
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`;
- `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Opener-Policy: same-origin`;
- a `Permissions-Policy` denying camera, microphone, geolocation, payment, USB, HID, serial, and Bluetooth, which grants
  `publickey-credentials-get` and `publickey-credentials-create` to self only, except on every path that serves the
  landing document (`/` and `/index.html`, matched after path normalisation, so `//` too), where both are denied
  (`=()`). Where the two matchers differ, the stricter result applies (for example `//`: app CSP and no WebAuthn).

Responses MUST NOT carry a `Server` header.

#### Scenario: Headers on the page
- **WHEN** `/app/` is requested from the running container
- **THEN** every listed header is present with the exact value, the CSP equals the app meta CSP + `; frame-ancestors 'none'`, the Permissions-Policy grants WebAuthn to self, and there is no `Server` header

#### Scenario: Headers on the landing document
- **WHEN** `/` or `/index.html` is requested from the running container
- **THEN** the CSP equals the landing meta CSP + `; frame-ancestors 'none'`, the Permissions-Policy contains `publickey-credentials-get=()` and `publickey-credentials-create=()`, every other listed header is present, and there is no `Server` header

#### Scenario: Framing refused
- **WHEN** another origin embeds the site in an iframe
- **THEN** the browser refuses to render it (`frame-ancestors 'none'` and `X-Frame-Options: DENY`)

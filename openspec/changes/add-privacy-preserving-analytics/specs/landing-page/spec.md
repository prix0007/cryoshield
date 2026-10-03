# Spec Delta

## MODIFIED Requirements

### Requirement: Same security headers and CSP on every page
Every HTML page SHALL carry a strict CSP meta tag: no `unsafe-inline`, no `unsafe-eval`, Trusted Types `'none'`. Every
page except the landing document SHALL carry the identical app CSP with `script-src 'self'`. The landing CSP SHALL
equal the app CSP plus only the analytics beacon source in `script-src` (if not self-hosted) and
`https://cloudflareinsights.com` in `connect-src`. Every HTTP response SHALL carry the security header set, with a CSP
equal to its document's meta CSP plus `frame-ancestors 'none'`. Only the integrity-pinned analytics beacon MAY load a
script from another origin, and only on the landing document.

#### Scenario: Identical CSP
- **WHEN** the production build is verified
- **THEN** every HTML page other than `index.html` carries the byte-identical app CSP meta tag, `index.html` carries the landing CSP, and the deploy context generator refuses to run if the landing CSP differs from the app CSP by anything other than the allowed analytics sources

#### Scenario: Headers on both pages
- **WHEN** `/` and `/app/` are requested from the container
- **THEN** both carry every security header with the exact value for their route, `/app/` carries the app CSP, `/` carries the landing CSP and a Permissions-Policy without WebAuthn, and neither has a `Server` header

#### Scenario: Other paths get the app CSP
- **WHEN** `/app`, `/app/index.html`, `/privacy`, `/cookies`, an unknown path and a 404 are requested
- **THEN** each carries the app CSP, which contains no Cloudflare origin

#### Scenario: CSP enforced on the landing page
- **WHEN** an inline script or an `innerHTML` assignment is injected into the landing page
- **THEN** it does not run and the browser reports a CSP or Trusted Types violation

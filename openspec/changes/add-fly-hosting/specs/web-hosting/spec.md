# Spec Delta

## Purpose

Defines how the CryoShield static web app is packaged, served, and deployed on Fly.io at its WebAuthn RP ID domain, so
that the bytes users load are the verified build and are served with clickjacking-proof security headers.

## ADDED Requirements

### Requirement: Serve only the verified build
The deployed image SHALL contain only the files of a locally built and verified `dist/`, plus a static-server
configuration. It MUST NOT contain `.env` files, source code, build arguments, or secrets. The static server image MUST
be pinned by digest.

#### Scenario: Image contents
- **WHEN** the deploy image is built
- **THEN** its web root equals the verified `dist/` (minus the host-specific `_headers` file), and no `.env` or secret appears in the image or in `fly.toml`

### Requirement: HTTP security headers
Every response SHALL carry:
- a `Content-Security-Policy` that equals the built `index.html` meta CSP followed by `; frame-ancestors 'none'`,
  derived from the build output and never hand-copied;
- `X-Frame-Options: DENY`;
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`;
- `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Opener-Policy: same-origin`;
- a `Permissions-Policy` granting `publickey-credentials-get` and `publickey-credentials-create` to self only, and
  denying camera, microphone, geolocation, payment, USB, HID, serial, and Bluetooth.

Responses MUST NOT carry a `Server` header.

#### Scenario: Headers on the page
- **WHEN** `/` is requested from the running container
- **THEN** every listed header is present with the exact value, the CSP equals meta CSP + `; frame-ancestors 'none'`, and there is no `Server` header

#### Scenario: Framing refused
- **WHEN** another origin embeds the site in an iframe
- **THEN** the browser refuses to render it (`frame-ancestors 'none'` and `X-Frame-Options: DENY`)

### Requirement: Caching and routing
`index.html` (and `/`) SHALL be served with `Cache-Control: no-cache`. Content-hashed files under `/assets/` SHALL be served with `Cache-Control: public, max-age=31536000, immutable`. Unknown paths SHALL return 404 with no SPA fallback. `/healthz` SHALL return 200 for the platform health check.

#### Scenario: Unknown path
- **WHEN** `/does-not-exist` or `/_headers` is requested
- **THEN** the response is 404 and still carries the security headers

### Requirement: Guarded deployment
The deploy script SHALL refuse to deploy when:
- the git working tree is not clean;
- `VITE_RP_ID` in `apps/web/.env` differs from the hostname being deployed;
- the built bundle's RP ID differs from that hostname;
- the production build is not reproducible or fails verification.

It SHALL run `fly deploy` only after all checks pass.

#### Scenario: Dirty tree
- **WHEN** the repository has uncommitted changes
- **THEN** deploy.sh exits non-zero before building, naming the reason, and never calls `fly`

#### Scenario: RP ID mismatch
- **WHEN** `VITE_RP_ID=example.com` and the target hostname is `cryoshield.app`
- **THEN** deploy.sh exits non-zero before building, naming both values, and never calls `fly`

### Requirement: Domain bound to the RP ID
The app SHALL be served at `https://cryoshield.app`, which equals `VITE_RP_ID`. `www.cryoshield.app` MAY be served
only as a 301 redirect to the apex. The runbook SHALL state that the RP ID cannot change once real vaults exist.

#### Scenario: www redirect
- **WHEN** `https://www.cryoshield.app/` is requested
- **THEN** the response is a 301 to `https://cryoshield.app/`

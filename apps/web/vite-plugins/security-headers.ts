/**
 * Non-CSP HTTP security headers: the single source for `_headers` (vite-plugins/csp.ts) and the Fly/Caddy config
 * (deploy/gen-context.mjs). The CSP itself always comes from the built index.html (add-fly-hosting D2).
 */
export const PERMISSIONS_POLICY = [
  'publickey-credentials-get=(self)',
  'publickey-credentials-create=(self)',
  'clipboard-write=(self)',
  'camera=()',
  'microphone=()',
  'geolocation=()',
  'payment=()',
  'usb=()',
  'hid=()',
  'serial=()',
  'bluetooth=()',
  'display-capture=()',
  'midi=()',
  'accelerometer=()',
  'gyroscope=()',
  'magnetometer=()',
  'browsing-topics=()',
].join(', ');

export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': PERMISSIONS_POLICY,
});

/**
 * The landing document (`/`, `/index.html`) may run the third-party analytics beacon on the vault's origin, so it can
 * never start a hardware-key ceremony (add-privacy-preserving-analytics, spec "Landing cannot use WebAuthn").
 */
export const LANDING_PERMISSIONS_POLICY = PERMISSIONS_POLICY.replace('publickey-credentials-get=(self)', 'publickey-credentials-get=()').replace(
  'publickey-credentials-create=(self)',
  'publickey-credentials-create=()',
);

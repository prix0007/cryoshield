// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { SECURITY_HEADERS, PERMISSIONS_POLICY } from '../../vite-plugins/security-headers';
import { headersFile } from '../../vite-plugins/csp';

describe('security headers (add-fly-hosting 1.1)', () => {
  it('has the exact values', () => {
    expect(SECURITY_HEADERS).toEqual({
      'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Permissions-Policy': PERMISSIONS_POLICY,
    });
  });

  it('Permissions-Policy allows WebAuthn (and clipboard-write) for self only and denies the rest', () => {
    const parts = Object.fromEntries(PERMISSIONS_POLICY.split(', ').map((d) => d.split('=') as [string, string]));
    expect(parts['publickey-credentials-get']).toBe('(self)');
    expect(parts['publickey-credentials-create']).toBe('(self)');
    expect(parts['clipboard-write']).toBe('(self)');
    for (const f of ['camera', 'microphone', 'geolocation', 'payment', 'usb', 'hid', 'serial', 'bluetooth']) expect(parts[f]).toBe('()');
    expect(Object.entries(parts).filter(([, v]) => v !== '()').map(([k]) => k).sort()).toEqual(
      ['clipboard-write', 'publickey-credentials-create', 'publickey-credentials-get'],
    );
  });

  it('_headers uses the same set', () => {
    const h = headersFile(['https://x.example']);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(h).toContain(`  ${k}: ${v}`);
  });
});

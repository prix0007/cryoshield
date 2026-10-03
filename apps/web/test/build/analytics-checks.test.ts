// @vitest-environment node
/** add-privacy-preserving-analytics 4.2 / 4.4 / 5.1: the verify-build analytics guards. */
import { describe, expect, it } from 'vitest';
import { analyticsLeaks, landingCspDiff, policyDrift } from '../../scripts/analytics-check.mjs';

const APP = "default-src 'none'; script-src 'self'; connect-src 'self' https://rpc.example; require-trusted-types-for 'script'";
const LANDING = "default-src 'none'; script-src 'self' https://static.cloudflareinsights.com/beacon.min.js; connect-src 'self' https://rpc.example https://cloudflareinsights.com; require-trusted-types-for 'script'";

describe('landing CSP difference', () => {
  it('allows only the beacon and the report origin', () => {
    expect(landingCspDiff(APP, LANDING)).toEqual([]);
    expect(landingCspDiff(APP, APP)).toEqual([]);
    expect(landingCspDiff(APP, LANDING.replace('https://cloudflareinsights.com', 'https://evil.example'))).toEqual(['connect-src adds https://evil.example']);
    expect(landingCspDiff(APP, LANDING.replace("require-trusted-types-for 'script'", ''))).toContain('require-trusted-types-for present on only one of the pages');
  });
});

describe('analytics confined to the landing document', () => {
  it('flags any app or legal file that mentions the beacon, its origin or the token', () => {
    expect(analyticsLeaks({ 'app/index.html': '<div id=root>', 'assets/app.js': 'x' }, 'abc123')).toEqual([]);
    expect(analyticsLeaks({ 'assets/app.js': 'fetch("https://cloudflareinsights.com/cdn-cgi/rum")' })).toEqual(['assets/app.js contains "cloudflareinsights"']);
    expect(analyticsLeaks({ 'privacy/index.html': 'token abc123' }, 'abc123')).toEqual(['privacy/index.html contains "abc123"']);
  });
});

describe('policy drift', () => {
  it('fails when /privacy or /cookies stop naming the analytics, naming the page', () => {
    const ok = 'Cloudflare Web Analytics ... cloudflareinsights.com';
    expect(policyDrift({ 'privacy/index.html': ok, 'cookies/index.html': ok })).toEqual([]);
    expect(policyDrift({ 'privacy/index.html': ok, 'cookies/index.html': 'nothing' })).toEqual([
      'cookies/index.html does not name cloudflareinsights.com',
      'cookies/index.html does not name Cloudflare Web Analytics',
    ]);
  });
});

describe('beacon pin (4.3)', () => {
  it('a production build emits exactly the committed lock integrity and URL; dev/E2E builds emit nothing', async () => {
    const { analyticsFor, beaconTemplate, sri384 } = await import('../../vite-plugins/analytics');
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = join(__dirname, '..', '..');
    const lock = JSON.parse(readFileSync(join(root, 'analytics', 'beacon.lock.json'), 'utf8'));
    const env = { VITE_CF_BEACON_TOKEN: 'ab'.repeat(16) };
    const a = analyticsFor(env, 'production', root, 'cryoshield.app')!;
    const t = beaconTemplate(a);
    expect(t).toContain(`integrity="${lock.sha384}"`);
    expect(t).toContain(`src="${lock.url}"`);
    expect(t).toContain('crossorigin="anonymous"');
    expect(t).toContain('&quot;spa&quot;:false');
    expect(analyticsFor(env, 'e2e', root, 'localhost')).toBeNull();
    expect(analyticsFor(env, 'development', root, 'localhost')).toBeNull();
    expect(analyticsFor({}, 'production', root, 'cryoshield.app')).toBeNull();
    expect(() => analyticsFor({ VITE_CF_BEACON_TOKEN: 'nope' }, 'production', root, 'cryoshield.app')).toThrow(/32-hex/);
    // The E2E lock pins the E2E stub's exact bytes.
    const e2e = JSON.parse(readFileSync(join(root, 'e2e', 'fixtures', 'beacon.lock.e2e.json'), 'utf8'));
    expect(sri384(readFileSync(join(root, 'e2e', 'fixtures', 'cf-beacon.stub.js')))).toBe(e2e.sha384);
  });
});

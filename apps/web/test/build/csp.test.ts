import { describe, expect, it } from 'vitest';
import { buildCsp, injectCsp, headersFile } from '../../vite-plugins/csp';

const origins = ['https://rpc.example', 'https://api.pimlico.io', 'https://upload.ardrive.io', 'https://arweave.net'];

describe('CSP', () => {
  it('is strict', () => {
    const csp = buildCsp(origins);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain(`connect-src 'self' ${origins.join(' ')}`);
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("require-trusted-types-for 'script'");
    expect(csp).toContain("trusted-types 'none'");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
  });

  it('injects a meta tag first in <head> and refuses inline scripts', () => {
    const html = injectCsp('<!doctype html><html><head><title>x</title></head><body></body></html>', origins);
    expect(html).toMatch(/<head><meta http-equiv="Content-Security-Policy" content="[^"]+">/);
    const withCharset = injectCsp('<html><head><meta charset="utf-8" /><script type="module" src="/a.js"></script></head></html>', origins);
    expect(withCharset.indexOf('charset')).toBeLessThan(withCharset.indexOf('Content-Security-Policy'));
    expect(withCharset.indexOf('Content-Security-Policy')).toBeLessThan(withCharset.indexOf('<script'));
    expect(() => injectCsp('<html><head></head><body><script>alert(1)</script></body></html>', origins)).toThrow(/inline/);
  });

  it('emits _headers with frame-ancestors (header-only directive)', () => {
    const h = headersFile(origins, origins);
    expect(h).toContain("frame-ancestors 'none'");
    expect(h).toContain('X-Content-Type-Options: nosniff');
    expect(h).toContain('Referrer-Policy: no-referrer');
  });
});

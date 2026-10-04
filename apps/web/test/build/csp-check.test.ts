// @vitest-environment node
/**
 * harden-codeql-web-findings (CodeQL #8/#9, js/incomplete-url-substring-sanitization): verify-build checks the app
 * CSP's connect-src as parsed directive tokens, not as substrings of the HTML. A prefix- or suffix-spoofed origin, a
 * missing origin or an unexpected extra token fails.
 */
import { describe, expect, it } from 'vitest';
import { connectSrcViolations, directives } from '../../scripts/csp-check.mjs';

const EXPECTED = ["'self'", 'https://rpc.verify.invalid', 'https://bundler.verify.invalid', 'https://upload.ardrive.io', 'https://arweave.net', 'https://turbo-gateway.com'];
const csp = (connect: string) => `default-src 'none'; script-src 'self'; connect-src ${connect}; img-src 'self' data:`;

describe('directives', () => {
  it('parses a CSP into directive -> tokens', () => {
    const d = directives(csp("'self' https://a.example"));
    expect(d.get('connect-src')).toEqual(["'self'", 'https://a.example']);
    expect(d.get('img-src')).toEqual(["'self'", 'data:']);
  });
});

describe('connectSrcViolations', () => {
  it('passes when connect-src is exactly the expected tokens (any order)', () => {
    expect(connectSrcViolations(csp([...EXPECTED].reverse().join(' ')), EXPECTED)).toEqual([]);
  });
  it('a prefix-spoofed origin does not satisfy the real one, and is itself unexpected', () => {
    const spoof = EXPECTED.map((t) => (t === 'https://rpc.verify.invalid' ? 'https://rpc.verify.invalid.evil.com' : t)).join(' ');
    const v = connectSrcViolations(csp(spoof), EXPECTED).join('\n');
    expect(v).toMatch(/missing https:\/\/rpc\.verify\.invalid$/m);
    expect(v).toMatch(/unexpected https:\/\/rpc\.verify\.invalid\.evil\.com/);
  });
  it('a suffix-spoofed (subdomain) or path-extended origin is refused', () => {
    for (const bad of ['https://evil.bundler.verify.invalid', 'https://bundler.verify.invalid/x', 'https://bundler.verify.invalid:8443']) {
      const v = connectSrcViolations(csp(EXPECTED.map((t) => (t === 'https://bundler.verify.invalid' ? bad : t)).join(' ')), EXPECTED).join('\n');
      expect(v, bad).toMatch(/missing https:\/\/bundler\.verify\.invalid/);
      expect(v, bad).toContain(`unexpected ${bad}`);
    }
  });
  it('an extra token (e.g. a wildcard or another host) is refused', () => {
    expect(connectSrcViolations(csp([...EXPECTED, 'https:'].join(' ')), EXPECTED).join()).toMatch(/unexpected https:/);
    expect(connectSrcViolations(csp([...EXPECTED, '*'].join(' ')), EXPECTED).join()).toMatch(/unexpected \*/);
  });
  it('a missing connect-src directive is refused', () => {
    expect(connectSrcViolations("default-src 'none'", EXPECTED).join()).toMatch(/no connect-src/);
  });
  it('the origin text elsewhere in the page cannot satisfy the check (only the directive counts)', () => {
    expect(connectSrcViolations(csp("'self'") + '; report-uri https://rpc.verify.invalid', EXPECTED).join()).toMatch(/missing https:\/\/rpc/);
  });
});

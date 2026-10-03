// @vitest-environment node
/** add-privacy-and-compliance 5.1 (spec legal-pages "Security contact file", "Expiry guard"). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkSecurityTxt } from '../../scripts/securitytxt-check.mjs';

const NOW = new Date('2026-10-03T00:00:00Z');
const txt = (expires: string) =>
  [
    'Contact: https://github.com/prix0007/cryoshield/security/advisories/new',
    `Expires: ${expires}`,
    'Policy: https://github.com/prix0007/cryoshield/blob/main/SECURITY.md',
    'Canonical: https://cryoshield.app/.well-known/security.txt',
    'Preferred-Languages: en, hi',
    '',
  ].join('\n');

describe('security.txt guard', () => {
  it('accepts an Expires within 365 days', () => {
    expect(checkSecurityTxt(txt('2027-09-30T23:59:59Z'), NOW)).toEqual([]);
  });
  it('fails when Expires is 400 days ahead, or in the past, naming the field', () => {
    expect(checkSecurityTxt(txt('2027-11-07T00:00:00Z'), NOW)[0]).toMatch(/Expires.*365 days/);
    expect(checkSecurityTxt(txt('2026-10-01T00:00:00Z'), NOW)[0]).toMatch(/Expires.*past/);
  });
  it('requires Contact, Expires, Policy, Canonical and Preferred-Languages', () => {
    expect(checkSecurityTxt('Contact: mailto:x@example.invalid\n', NOW)).toEqual(expect.arrayContaining([expect.stringMatching(/Expires/), expect.stringMatching(/Policy/), expect.stringMatching(/Canonical/), expect.stringMatching(/Preferred-Languages/)]));
  });
  it('the shipped file passes today', () => {
    const shipped = readFileSync(join(__dirname, '..', '..', 'public', '.well-known', 'security.txt'), 'utf8');
    expect(checkSecurityTxt(shipped, new Date())).toEqual([]);
    expect(shipped).toContain('Canonical: https://cryoshield.app/.well-known/security.txt');
    // adopt-oss-project-defaults: GitHub private vulnerability reporting is the only contact; no mailbox exists.
    expect(shipped.split('\n').filter((l) => l.startsWith('Contact:'))).toEqual(['Contact: https://github.com/prix0007/cryoshield/security/advisories/new']);
    expect(shipped).not.toMatch(/mailto:|@cryoshield\.app/);
  });
});

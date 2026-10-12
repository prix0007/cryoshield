// @vitest-environment node
/** adopt-oss-project-defaults 2.3 (spec project-contact "Privacy request template warns about secrets"). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Written in YAML's JSON-compatible flow style, so a strict JSON parse validates the structure.
const form = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', '.github', 'ISSUE_TEMPLATE', 'privacy-request.yml'), 'utf8')) as {
  name: string;
  description: string;
  body: { type: string; id?: string; attributes: Record<string, unknown>; validations?: { required?: boolean } }[];
};

describe('privacy-request issue form', () => {
  it('is a GitHub issue form with a name, description and body', () => {
    expect(form.name).toBe('Privacy request');
    expect(form.description).toMatch(/PUBLIC/);
    expect(form.body.length).toBeGreaterThanOrEqual(3);
  });

  it('opens with a warning never to post secrets, keys, recovery codes or PINs, and points sensitive requests to a private advisory', () => {
    const first = form.body[0]!;
    expect(first.type).toBe('markdown');
    const v = String(first.attributes.value);
    for (const w of ['Never post', 'seed phrases', 'recovery codes', 'private keys', 'PINs', 'public']) expect(v).toContain(w);
    expect(v).toContain('https://github.com/prix0007/cryoshield/security/advisories/new');
    expect(v).not.toMatch(/@cryoshield\.app|mailto:/);
  });

  it('offers only requests that fit a project holding no personal data (trim-privacy-rights-grievance 1.4)', () => {
    const d = form.body.find((b) => b.type === 'dropdown' && b.id === 'kind')!;
    expect(d.attributes.options).toEqual(['Deletion or redaction (e.g. of something I posted on GitHub)', 'Question about the privacy policy', 'Other']);
    // The whole form (chooser description and every markdown block), not only the first block (#98 review).
    const all = [form.description, ...form.body.map((b) => String(b.attributes.value ?? ''))].join('\n');
    expect(all).not.toMatch(/24 hours|15 days|Grievance|DPDP|correct|personal data .*hold/i);
  });

  it('requires the reporter to confirm they posted no secrets', () => {
    const c = form.body.find((b) => b.type === 'checkboxes')!;
    const opts = c.attributes.options as { label: string; required: boolean }[];
    expect(opts.some((o) => o.required && /not posted any secret/.test(o.label))).toBe(true);
  });
});

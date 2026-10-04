// add-issue-triage: every issue template opens with the bold secrets warning; a security contact link exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';

const dir = new URL('../../ISSUE_TEMPLATE/', import.meta.url);
const WARNING = '**Never post seed phrases, recovery codes, PINs or keys**';
const templates = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f) && f !== 'config.yml');

test('bug, feature and privacy-request templates exist', () => {
  for (const f of ['bug.yml', 'feature.yml', 'privacy-request.yml']) assert.ok(templates.includes(f), f);
});

for (const f of templates) {
  test(`${f}: the first form element is markdown carrying the bold warning`, () => {
    const t = parse(readFileSync(new URL(f, dir), 'utf8'));
    assert.equal(t.body[0].type, 'markdown');
    assert.ok(t.body[0].attributes.value.includes(WARNING), f);
  });
}

test('config.yml routes vulnerabilities to private reporting', () => {
  const c = parse(readFileSync(new URL('config.yml', dir), 'utf8'));
  assert.ok(c.contact_links.some((l) => l.url === 'https://github.com/prix0007/cryoshield/security/advisories/new'));
});

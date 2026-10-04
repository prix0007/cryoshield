// add-issue-triage: every issue template opens with the bold secrets warning; a security contact link exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';

const dir = new URL('../../ISSUE_TEMPLATE/', import.meta.url);
const WARNING = '**Never post seed phrases, recovery codes, PINs or keys**';
const templates = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f) && f !== 'config.yml');

test('bug, feature, privacy-request and device-report templates exist', () => {
  for (const f of ['bug.yml', 'feature.yml', 'privacy-request.yml', 'device-report.yml']) assert.ok(templates.includes(f), f);
});

// add-supported-devices-page: the device report asks for model, firmware, OS, browser and what worked, and makes the
// reporter confirm they posted no secrets.
test('device-report.yml is a valid issue form with the device fields and a required no-secrets confirmation', () => {
  const t = parse(readFileSync(new URL('device-report.yml', dir), 'utf8'));
  assert.equal(t.name, 'Device report');
  assert.match(t.description, /PUBLIC/);
  const ids = t.body.filter((b) => b.id).map((b) => b.id);
  for (const id of ['model', 'firmware', 'os', 'browser', 'worked', 'no-secrets']) assert.ok(ids.includes(id), id);
  for (const id of ['model', 'firmware', 'os']) assert.equal(t.body.find((b) => b.id === id).validations?.required, true, id);
  const confirm = t.body.find((b) => b.id === 'no-secrets');
  assert.ok(confirm.attributes.options.every((o) => o.required === true));
  for (const b of t.body) assert.ok(['markdown', 'input', 'textarea', 'dropdown', 'checkboxes'].includes(b.type), b.type);
  assert.ok(new Set(ids).size === ids.length, 'unique ids');
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

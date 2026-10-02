import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JUSTIFICATION_MARKER } from '../openspec-gate.mjs';

const template = readFileSync(new URL('../../pull_request_template.md', import.meta.url), 'utf8');
const codeowners = readFileSync(new URL('../../CODEOWNERS', import.meta.url), 'utf8');

test('template has the required sections', () => {
  for (const heading of ['## OpenSpec change', '## Tests run', '## Security review', '## Screenshots (UI changes)']) {
    assert.ok(template.includes(`\n${heading}\n`), `missing ${heading}`);
  }
  assert.match(template, /N\/A/);
});

test('template carries the justification line the OpenSpec gate parses, empty by default', () => {
  const line = template.split('\n').find((l) => l.startsWith(JUSTIFICATION_MARKER));
  assert.ok(line, `missing "${JUSTIFICATION_MARKER}" line`);
  assert.equal(line.slice(JUSTIFICATION_MARKER.length).trim(), '');
});

test('CODEOWNERS assigns every path to the maintainer', () => {
  assert.match(codeowners, /^\*\s+@prix0007$/m);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JUSTIFICATION_MARKER } from '../openspec-gate.mjs';

const template = readFileSync(new URL('../../pull_request_template.md', import.meta.url), 'utf8');
const codeowners = readFileSync(new URL('../../CODEOWNERS', import.meta.url), 'utf8');

test('template has the required sections', () => {
  for (const heading of ['## OpenSpec change', '## Tasks covered', '## Verification', '## Security review', '## Screenshots (UI changes)', '## Review']) {
    assert.ok(template.includes(`\n${heading}\n`), `missing ${heading}`);
  }
  assert.match(template, /N\/A/);
});

test('template explains the review and merge flow (ecc-review, /ecc-review, auto-merge, hold)', () => {
  for (const word of ['ecc-review', '/ecc-review', 'auto-merge', '`hold`', 'CLAUDE.md']) {
    assert.ok(template.includes(word), `missing ${word}`);
  }
});

test('AGENTS.md points to CLAUDE.md, which documents the change flow', () => {
  const agents = readFileSync(new URL('../../../AGENTS.md', import.meta.url), 'utf8');
  const claude = readFileSync(new URL('../../../CLAUDE.md', import.meta.url), 'utf8');
  assert.match(agents, /CLAUDE\.md/);
  assert.match(claude, /^## Change flow \(one PR per change\)$/m);
  assert.match(claude, /<!-- claude-pr-flow -->/);
});

test('template carries the justification line the OpenSpec gate parses, empty by default', () => {
  const line = template.split('\n').find((l) => l.startsWith(JUSTIFICATION_MARKER));
  assert.ok(line, `missing "${JUSTIFICATION_MARKER}" line`);
  assert.equal(line.slice(JUSTIFICATION_MARKER.length).trim(), '');
});

test('CODEOWNERS assigns every path to the maintainer', () => {
  assert.match(codeowners, /^\*\s+@prix0007$/m);
});

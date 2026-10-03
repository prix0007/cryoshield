#!/usr/bin/env node
/**
 * add-privacy-and-compliance 3.5 (spec legal-pages "Versioned legal text"): when a legal source file changes between
 * --base and HEAD, its "**Effective date:**" line must change too. Run in CI on pull requests:
 *   node apps/web/scripts/check-legal-dates.mjs --base origin/main
 */
import { execFileSync } from 'node:child_process';

const i = process.argv.indexOf('--base');
const base = i > 0 ? process.argv[i + 1] : 'origin/main';
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const DIR = 'apps/web/legal';
const dateOf = (text) => text.match(/^\*\*Effective date:\*\*\s*(\d{4}-\d{2}-\d{2})\s*$/m)?.[1];

const changed = git('diff', '--name-only', `${base}...HEAD`, '--', DIR)
  .split('\n')
  .filter((f) => f.endsWith('.md'));
const errors = [];
for (const f of changed) {
  let after;
  try {
    after = git('show', `HEAD:${f}`);
  } catch {
    continue; // deleted
  }
  let before = null;
  try {
    before = git('show', `${base}:${f}`);
  } catch {
    /* new file */
  }
  const d1 = before === null ? null : dateOf(before);
  const d2 = dateOf(after);
  if (!d2) errors.push(`${f}: no "**Effective date:** YYYY-MM-DD" line`);
  else if (before !== null && d1 === d2 && before !== after) errors.push(`${f}: text changed but the effective date (${d2}) did not`);
}
if (errors.length) {
  console.error(errors.map((e) => `FAIL ${e}`).join('\n'));
  process.exit(1);
}
console.log(`ok   legal effective dates (${changed.length} changed file(s) checked against ${base})`);

// @vitest-environment node
/** add-privacy-and-compliance 3.3 (draft banner vs placeholders) and 3.5 (effective date changes with content). */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkLegalDraft, unlistedStorageApis } from '../../scripts/legal-check.mjs';
import { readFileSync } from 'node:fs';

describe('draft banner guard (3.3)', () => {
  it('fails a page that still has a placeholder but no banner, naming page and token', () => {
    expect(checkLegalDraft('<main><p>Operated by [ENTITY].</p></main>', 'privacy/index.html')).toEqual(['privacy/index.html: placeholder [ENTITY] without the "Draft, pending legal review" banner']);
  });
  it('passes with the banner, or with no placeholders at all', () => {
    expect(checkLegalDraft('<p class="draft-banner">Draft, pending legal review.</p><p>[CONTACT EMAIL]</p>', 'x')).toEqual([]);
    expect(checkLegalDraft('<p>Operated by Example Pvt Ltd.</p>', 'x')).toEqual([]);
  });
});

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'check-legal-dates.mjs');
function repo(files: Record<string, string>) {
  const d = mkdtempSync(join(tmpdir(), 'cs-legal-git-'));
  const git = (...a: string[]) => execFileSync('git', a, { cwd: d, stdio: 'pipe', encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 't');
  mkdirSync(join(d, 'apps', 'web', 'legal'), { recursive: true });
  const write = (f: Record<string, string>) => {
    for (const [k, v] of Object.entries(f)) writeFileSync(join(d, 'apps', 'web', 'legal', k), v);
    git('add', '-A');
    git('commit', '-q', '-m', 'x');
    return git('rev-parse', 'HEAD').trim();
  };
  const base = write(files);
  return { d, base, write };
}
const run = (d: string, base: string) => {
  try {
    execFileSync('node', [SCRIPT, '--base', base], { cwd: d, stdio: 'pipe', encoding: 'utf8' });
    return { ok: true, out: '' };
  } catch (e) {
    return { ok: false, out: String((e as { stderr?: string }).stderr) };
  }
};
const doc = (date: string, body: string) => `# Privacy\n\n**Effective date:** ${date}\n\n${body}\n`;

describe('effective date changes with content (3.5)', () => {
  it('fails when the text changed but the effective date did not', () => {
    const r = repo({ 'privacy.md': doc('2026-10-03', 'old') });
    r.write({ 'privacy.md': doc('2026-10-03', 'new text') });
    const res = run(r.d, r.base);
    expect(res.ok).toBe(false);
    expect(res.out).toMatch(/privacy\.md/);
  });
  it('passes when the date changed with the text, or nothing changed', () => {
    const r = repo({ 'privacy.md': doc('2026-10-03', 'old'), 'terms.md': doc('2026-10-03', 't') });
    r.write({ 'privacy.md': doc('2026-11-01', 'new text') });
    expect(run(r.d, r.base).ok).toBe(true);
  });
  it('fails a new or edited page that has no effective date line', () => {
    const r = repo({ 'privacy.md': doc('2026-10-03', 'old') });
    r.write({ 'cookies.md': '# Cookies\n\nNo date.\n' });
    expect(run(r.d, r.base).ok).toBe(false);
  });
});

describe('device-storage inventory guard', () => {
  const inv = JSON.parse(readFileSync(join(__dirname, '..', '..', 'legal', 'storage-inventory.json'), 'utf8'));
  it('flags a bundle that starts using storage the inventory does not list', () => {
    expect(unlistedStorageApis('x=1;window.localStorage.setItem("a","b");document.cookie="c=d"', inv)).toEqual(['localStorage', 'document.cookie']);
  });
  it('the published inventory lists no storage API and no entries on any route', () => {
    expect(inv.apis).toEqual([]);
    for (const r of Object.values(inv.routes) as Record<string, string[]>[]) for (const v of Object.values(r)) expect(v).toEqual([]);
  });
});

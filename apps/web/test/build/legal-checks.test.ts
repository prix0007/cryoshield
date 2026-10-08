// @vitest-environment node
/** adopt-oss-project-defaults 1.1 (no placeholders/mailboxes) and add-privacy-and-compliance 3.5 (effective date). */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkNoPlaceholders, storageApiOutsideAllowedFiles, unlistedStorageApis } from '../../scripts/legal-check.mjs';
import { readFileSync } from 'node:fs';

describe('no placeholders or project mailboxes in shipped files (adopt-oss-project-defaults 1.1)', () => {
  it('fails on any bracketed ALL-CAPS placeholder or @cryoshield.app address, naming file and token', () => {
    expect(checkNoPlaceholders('<p>Operated by [ENTITY], [REGISTERED ADDRESS].</p>', 'privacy/index.html')).toEqual([
      'privacy/index.html: placeholder [ENTITY]',
      'privacy/index.html: placeholder [REGISTERED ADDRESS]',
    ]);
    expect(checkNoPlaceholders('Contact: mailto:security@cryoshield.app', '.well-known/security.txt')).toEqual(['.well-known/security.txt: address security@cryoshield.app']);
  });
  it('passes normal prose, links and code', () => {
    expect(checkNoPlaceholders('<p>See [our docs](https://x) and <code>[a]</code>, the 18+ rule, [1] and [Note].</p>', 'x')).toEqual([]);
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
  it('accepts a same-day revision marker as a date change (adopt-oss-project-defaults)', () => {
    const r = repo({ 'privacy.md': doc('2026-10-03', 'old') });
    r.write({ 'privacy.md': doc('2026-10-03 (revision 2)', 'new text') });
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
    expect(unlistedStorageApis('x=1;window.sessionStorage.setItem("a","b");document.cookie="c=d"', inv)).toEqual(['sessionStorage', 'document.cookie']);
    // localStorage is listed (the theme preference), so only the per-file guard below can catch its misuse.
    expect(unlistedStorageApis('window.localStorage.setItem("a","b")', inv)).toEqual([]);
  });
  it('the published inventory lists one storage API (the theme preference) and no entry a page creates on its own', () => {
    // add-theme-switch D5: localStorage only, only in the theme script, only when the visitor picks Light or Dark.
    expect(inv.apis).toEqual(['localStorage']);
    expect(inv.apiFiles).toEqual({ localStorage: 'theme' });
    for (const r of Object.values(inv.routes) as Record<string, string[]>[]) for (const v of Object.values(r)) expect(v).toEqual([]);
    expect(inv.preferences).toHaveLength(1);
    expect(inv.preferences[0]).toMatchObject({ storage: 'localStorage', key: 'cryoshield-theme', values: ['light', 'dark'] });
  });
  it('flags a listed API used outside its allowed file (localStorage only in the theme script)', () => {
    const files = {
      'assets/theme-0a1b2c3d.js': 'localStorage.getItem("cryoshield-theme")',
      'assets/index-ab12cd34.js': 'export const x=1',
    };
    const referenced = ['assets/theme-0a1b2c3d.js']; // the theme script the pages actually load
    expect(storageApiOutsideAllowedFiles(files, inv, referenced)).toEqual([]);
    expect(storageApiOutsideAllowedFiles({ ...files, 'assets/vault-1234abcd.js': 'window.localStorage.setItem("k","v")' }, inv, referenced)).toEqual([
      'assets/vault-1234abcd.js uses localStorage (allowed only in assets/theme-0a1b2c3d.js)',
    ]);
    // A file merely named like the theme asset elsewhere does not count.
    expect(storageApiOutsideAllowedFiles({ 'assets/x/theme-0a1b2c3d.js.map.js': 'localStorage' }, inv, referenced)).toHaveLength(1);
    // Review: a second, unreferenced theme-named asset is not allowed, even with a valid-looking name.
    expect(storageApiOutsideAllowedFiles({ ...files, 'assets/theme-deadbeef.js': 'localStorage.setItem("x","y")' }, inv, referenced)).toEqual([
      'assets/theme-deadbeef.js uses localStorage (allowed only in assets/theme-0a1b2c3d.js)',
    ]);
    // No referenced theme script: nothing may use localStorage.
    expect(storageApiOutsideAllowedFiles(files, inv, [])).toHaveLength(1);
    // Unlisted APIs are still flagged by unlistedStorageApis.
    expect(unlistedStorageApis('sessionStorage.setItem("a","b")', inv)).toEqual(['sessionStorage']);
  });
});

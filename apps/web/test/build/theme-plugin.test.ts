// @vitest-environment node
/** add-theme-switch 1.2 (spec site-theme "Theme applies before first paint"; design D1). */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { injectCsp } from '../../vite-plugins/csp';
import { THEME_SOURCE, injectThemeScript, themeAsset } from '../../vite-plugins/theme';

const root = join(__dirname, '..', '..');
const src = readFileSync(join(root, THEME_SOURCE), 'utf8');
const page = '<!doctype html><html lang="en"><head><meta charset="utf-8" /><link rel="stylesheet" href="/assets/a.css"><script type="module" src="/assets/a.js"></script></head><body><p>x</p></body></html>';

describe('theme plugin', () => {
  it('ships the script minified, named by the hash of the shipped bytes (reproducible builds, immutable cache)', () => {
    const a = themeAsset(src);
    expect(a.fileName).toBe(`assets/theme-${createHash('sha256').update(a.source).digest('hex').slice(0, 8)}.js`);
    expect(themeAsset(src)).toEqual(a); // deterministic
    expect(a.source.length).toBeLessThan(src.length / 2);
    expect(a.source).not.toMatch(/\/\*|\/\//); // no comments
    for (const s of ['cryoshield-theme', 'select[data-theme-select]', '[data-theme-switch][hidden]', 'DOMContentLoaded', 'storage']) expect(a.source).toContain(s);
    expect(themeAsset(src.replace("'dark'", "'dark' "))).toEqual(a); // whitespace-only change: same bytes, same name
    expect(themeAsset(src.replace("'cryoshield-theme'", "'cryoshield-themes'")).fileName).not.toBe(a.fileName);
  });

  it('injects exactly one classic, same-origin script at the end of <head>', () => {
    const out = injectThemeScript(page, '/assets/theme-abcd1234.js');
    expect(out.match(/<script src="\/assets\/theme-abcd1234\.js"><\/script>/g)).toHaveLength(1);
    const head = out.slice(0, out.indexOf('</head>'));
    expect(head).toContain('theme-abcd1234.js');
    expect(head.lastIndexOf('<script')).toBe(head.indexOf('<script src="/assets/theme-'));
    // A classic script (not type=module): it blocks parsing, so it runs before <body> and before first paint.
    expect(out).not.toMatch(/<script type="module" src="\/assets\/theme-/);
    expect(out.indexOf('theme-abcd1234.js')).toBeLessThan(out.indexOf('<body'));
  });

  it('stays after the CSP meta, whichever plugin runs first', () => {
    for (const html of [injectCsp(injectThemeScript(page, '/assets/theme-x.js'), []), injectThemeScript(injectCsp(page, []), '/assets/theme-x.js')]) {
      expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('theme-x.js'));
    }
  });

  it('refuses a page without </head> or one that already has the script', () => {
    expect(() => injectThemeScript('<html><body></body></html>', '/assets/theme-x.js')).toThrow(/head/);
    expect(() => injectThemeScript(injectThemeScript(page, '/assets/theme-x.js'), '/assets/theme-x.js')).toThrow(/already/);
  });

  it('the source is the classic script in src/theme', () => {
    expect(THEME_SOURCE).toBe('src/theme/theme-init.js');
    expect(src).not.toMatch(/^\s*(import|export)\s/m);
  });
});

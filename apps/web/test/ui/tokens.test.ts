// @vitest-environment node
/**
 * redesign-landing-and-app-ui 1.2 (spec app-visual-design "Design tokens", "Token contrast", "Typography"):
 * every token pair the UI uses meets WCAG 2.2 AA in both themes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, '..', '..', 'src', 'ui', 'tokens.css'), 'utf8');

function block(src: string, start: number): string {
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error('unbalanced');
}
function vars(body: string): Record<string, string> {
  return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}
const light = vars(block(css, css.indexOf(':root')));
const darkAt = css.indexOf('@media (prefers-color-scheme: dark)');
const dark = { ...light, ...vars(block(block(css, darkAt), 0)) };

function resolve(theme: Record<string, string>, name: string): string {
  let v = theme[name];
  for (let i = 0; v && v.startsWith('var(') && i < 5; i++) v = theme[v.slice(4, -1).trim()];
  if (!v || !/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`${name} is not an opaque hex colour: ${v}`);
  return v;
}
function lum(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
export function contrast(a: string, b: string) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

/** App pairs (themed): [foreground, background]. */
const APP_TEXT: [string, string][] = [
  ['--app-ink', '--app-bg'],
  ['--app-ink', '--app-surface'],
  ['--app-muted', '--app-bg'],
  ['--app-muted', '--app-surface'],
  ['--app-link', '--app-bg'],
  ['--app-link', '--app-surface'],
  ['--app-error', '--app-bg'],
  ['--app-error', '--app-surface'],
  ['--on-primary', '--color-primary'],
  ['--body-on-dark', '--surface-black'], // global nav
];
const APP_BOUNDARY: [string, string][] = [
  ['--app-focus', '--app-bg'],
  ['--app-focus', '--app-surface'],
  ['--app-input-border', '--app-surface'],
  ['--app-input-border', '--app-bg'],
  ['--color-primary', '--app-bg'], // outlined secondary pill border
  ['--color-primary', '--app-surface'],
  ['--color-primary-on-dark', '--surface-black'], // focus ring in the black nav
];
/** Landing pairs (fixed light/dark tiles, not themed). */
const LANDING_TEXT: [string, string][] = [
  ['--ink', '--canvas'],
  ['--ink', '--canvas-parchment'],
  ['--color-primary', '--canvas'],
  ['--color-primary', '--canvas-parchment'],
  ['--ink-muted-80', '--canvas-parchment'],
  ['--ink-muted-48', '--canvas'],
  ['--ink-muted-48', '--canvas-parchment'],
  ['--body-on-dark', '--surface-tile-1'],
  ['--body-on-dark', '--surface-tile-2'],
  ['--body-on-dark', '--surface-tile-3'],
  ['--body-muted', '--surface-tile-1'],
  ['--body-muted', '--surface-tile-2'],
  ['--body-muted', '--surface-tile-3'],
  ['--color-primary-on-dark', '--surface-tile-1'],
  ['--color-primary-on-dark', '--surface-tile-2'],
  ['--color-primary-on-dark', '--surface-tile-3'],
  ['--color-primary-on-dark', '--surface-black'],
];
const LANDING_BOUNDARY: [string, string][] = [
  ['--color-primary-focus', '--canvas'],
  ['--color-primary-focus', '--canvas-parchment'],
  ['--color-primary-on-dark', '--surface-tile-1'],
  ['--color-primary-on-dark', '--surface-tile-3'],
];

describe('token contrast (WCAG 2.2 AA)', () => {
  for (const [name, theme] of [['light', light], ['dark', dark]] as const) {
    it.each(APP_TEXT)(`${name}: text %s on %s >= 4.5`, (fg, bg) => {
      expect(contrast(resolve(theme, fg), resolve(theme, bg))).toBeGreaterThanOrEqual(4.5);
    });
    it.each(APP_BOUNDARY)(`${name}: boundary %s on %s >= 3`, (fg, bg) => {
      expect(contrast(resolve(theme, fg), resolve(theme, bg))).toBeGreaterThanOrEqual(3);
    });
  }
  it.each(LANDING_TEXT)('landing: text %s on %s >= 4.5', (fg, bg) => {
    expect(contrast(resolve(light, fg), resolve(light, bg))).toBeGreaterThanOrEqual(4.5);
  });
  it.each(LANDING_BOUNDARY)('landing: boundary %s on %s >= 3', (fg, bg) => {
    expect(contrast(resolve(light, fg), resolve(light, bg))).toBeGreaterThanOrEqual(3);
  });
});

describe('token set', () => {
  it('keeps the guide values (with the recorded AA deviations) and one functional error ink', () => {
    expect(light['--color-primary']).toBe('#0066cc');
    expect(light['--color-primary-focus']).toBe('#0071e3');
    expect(light['--color-primary-on-dark']).toBe('#2997ff');
    expect(light['--ink']).toBe('#1d1d1f');
    expect(light['--canvas-parchment']).toBe('#f5f5f7');
    expect(light['--ink-muted-48']).toBe('#6e6e73'); // guide #7a7a7a is 4.29:1 on white (design D6)
    expect(light['--error-ink']).toBe('#c4161c');
    expect(light['--error-ink-on-dark']).toBe('#ff6961');
    expect(light['--body-size']).toBe('17px');
    expect(light['--radius-pill']).toBe('9999px');
    expect(light['--radius-lg']).toBe('18px');
  });

  it('has no hue besides the blue accent family and the error ink (greys only)', () => {
    const allowed = new Set(['--color-primary', '--color-primary-focus', '--color-primary-on-dark', '--error-ink', '--error-ink-on-dark', '--app-link', '--app-focus', '--app-error']);
    for (const theme of [light, dark]) {
      for (const [k, v] of Object.entries(theme)) {
        const m = v.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
        if (!m || allowed.has(k)) continue;
        const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h!, 16));
        expect(Math.max(r!, g!, b!) - Math.min(r!, g!, b!), `${k} ${v} is not a neutral grey`).toBeLessThanOrEqual(8);
      }
    }
  });

  it('never uses font-weight 500, and fonts are same-origin', () => {
    expect(css).not.toMatch(/font-weight:\s*500/);
    for (const m of css.matchAll(/url\(([^)]+)\)/g)) expect(m[1]).not.toMatch(/^['"]?(https?:)?\/\//);
  });
});

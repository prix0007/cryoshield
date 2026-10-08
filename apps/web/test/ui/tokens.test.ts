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
const light = vars(block(css, css.indexOf(':root {')));
// add-theme-switch D2: a forced Dark theme and System on a dark device use one palette, declared twice.
const forcedDarkBody = block(css, css.indexOf(":root[data-theme='dark'] {"));
const mediaAt = css.indexOf('@media (prefers-color-scheme: dark)');
const mediaBody = block(css, mediaAt);
const systemDarkBody = block(mediaBody, mediaBody.indexOf(":root:not([data-theme='light']) {"));
const dark = { ...light, ...vars(forcedDarkBody) };

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
  ['--app-disabled-ink', '--app-disabled-bg'], // disabled pills (kept AA although exempt)
];
const APP_BOUNDARY: [string, string][] = [
  ['--app-focus', '--app-bg'],
  ['--app-focus', '--app-surface'],
  ['--app-input-border', '--app-surface'],
  ['--app-input-border', '--app-bg'],
  ['--color-primary', '--app-bg'], // outlined secondary pill border
  ['--color-primary', '--app-surface'],
  ['--color-primary-on-dark', '--surface-black'], // focus ring in the black nav
  ['--input-border', '--surface-black'], // the theme switch's border in the black nav (add-theme-switch D4)
];
/** Page pairs (themed, add-theme-switch D2/D3): the landing's light tiles, sub-nav and footer, and the legal layout. */
const PAGE_TEXT: [string, string][] = [
  ['--page-ink', '--page-canvas'],
  ['--page-ink', '--page-parchment'],
  ['--page-muted-80', '--page-canvas'],
  ['--page-muted-80', '--page-parchment'],
  ['--page-muted-48', '--page-canvas'],
  ['--page-muted-48', '--page-parchment'],
  ['--page-link', '--page-canvas'],
  ['--page-link', '--page-parchment'],
  ['--on-primary', '--color-primary-fill'], // filled pills and the skip link, both themes
];
const PAGE_BOUNDARY: [string, string][] = [
  ['--page-focus', '--page-canvas'],
  ['--page-focus', '--page-parchment'],
  ['--page-input-border', '--page-canvas'],
  ['--page-input-border', '--page-parchment'],
  ['--page-link', '--page-canvas'], // outlined secondary pills
  ['--page-link', '--page-parchment'],
  ['--color-primary-fill', '--page-canvas'], // filled pill shape against the page
  ['--color-primary-fill', '--page-parchment'],
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
    it.each(PAGE_TEXT)(`${name}: page text %s on %s >= 4.5`, (fg, bg) => {
      expect(contrast(resolve(theme, fg), resolve(theme, bg))).toBeGreaterThanOrEqual(4.5);
    });
    it.each(PAGE_BOUNDARY)(`${name}: page boundary %s on %s >= 3`, (fg, bg) => {
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

describe('white on blue (add-theme-switch review H1/M1)', () => {
  // White text or a white check mark sits on a blue fill in: the copy chip, the key-slot badge, the done stage icon.
  // The link blue fails with white in dark (3.01:1); the fill blue passes in both themes.
  it('the link blue is too light for white in dark, the fill blue is AA in both themes', () => {
    expect(contrast(resolve(dark, '--on-primary'), resolve(dark, '--app-link'))).toBeLessThan(4.5);
    for (const theme of [light, dark]) expect(contrast(resolve(theme, '--on-primary'), resolve(theme, '--color-primary-fill'))).toBeGreaterThanOrEqual(4.5);
  });
  const g = readFileSync(join(__dirname, '..', '..', 'src', 'ui', 'global.css'), 'utf8');
  const rule = (sel: string) => {
    const at = g.indexOf(`\n${sel} {`);
    expect(at, sel).toBeGreaterThan(-1);
    return block(g, at);
  };
  it.each(['.copy-chip', '.key-slot-badge', '.stage-done .stage-icon'])('%s fills with --color-primary-fill, never the link blue', (sel) => {
    const body = rule(sel);
    expect(body).toMatch(/background:\s*var\(--color-primary-fill\)/);
    expect(body).not.toMatch(/var\(--app-link\)/);
  });
  it('no rule puts white (--on-primary) text on a --app-link background', () => {
    for (const m of g.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = m[2]!;
      if (/background:\s*var\(--app-link\)/.test(body)) expect(body, m[1]!.trim()).not.toMatch(/var\(--on-primary\)/);
    }
  });
});

describe('/architecture highlighted labels (add-theme-switch review L6)', () => {
  // .arch-hl-text (--app-link, 12-13px) sits on .arch-hl (--app-accent-soft, translucent) inside a figure on --app-bg.
  const over = (rgba: string, bg: string) => {
    const m = rgba.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/)!;
    const a = Number(m[4]);
    const b = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16));
    return '#' + [1, 2, 3].map((i, k) => Math.round(a * Number(m[i]) + (1 - a) * b[k]!).toString(16).padStart(2, '0')).join('');
  };
  it.each([
    ['light', light],
    ['dark', dark],
  ] as const)('%s: link text on the soft accent over the figure is >= 4.5', (_n, theme) => {
    const bg = over(theme['--app-accent-soft']!, resolve(theme, '--app-bg'));
    expect(contrast(resolve(theme, '--app-link'), bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('theme blocks (add-theme-switch D2)', () => {
  it('the forced-dark block and the system-dark block are identical', () => {
    expect(mediaAt).toBeGreaterThan(0);
    expect(vars(systemDarkBody)).toEqual(vars(forcedDarkBody));
    expect(systemDarkBody.match(/color-scheme:\s*([^;]+);/)?.[1]).toBe('dark');
    expect(forcedDarkBody.match(/color-scheme:\s*([^;]+);/)?.[1]).toBe('dark');
  });
  it('the media query applies only when no explicit Light is chosen; Light forces the light scheme', () => {
    expect(mediaBody.trim()).toMatch(/^:root:not\(\[data-theme='light'\]\)\s*\{[^{}]*\}$/);
    expect(block(css, css.indexOf(':root {'))).toMatch(/color-scheme:\s*light dark;/);
    expect(block(css, css.indexOf(":root[data-theme='light'] {"))).toMatch(/color-scheme:\s*light;/);
    expect(css.match(/@media \(prefers-color-scheme/g)).toHaveLength(1);
  });
  it('page tokens equal the base tokens in light, so light pages look exactly as before', () => {
    const same: [string, string][] = [
      ['--page-canvas', '--canvas'],
      ['--page-parchment', '--canvas-parchment'],
      ['--page-ink', '--ink'],
      ['--page-muted-80', '--ink-muted-80'],
      ['--page-muted-48', '--ink-muted-48'],
      ['--page-hairline', '--hairline'],
      ['--page-input-border', '--input-border'],
      ['--page-link', '--color-primary'],
      ['--page-focus', '--color-primary-focus'],
    ];
    for (const [p, b] of same) expect(resolve(light, p), p).toBe(resolve(light, b));
    expect(resolve(light, '--color-primary-fill')).toBe('#0066cc');
    expect(resolve(dark, '--color-primary-fill')).toBe('#0066cc');
  });
  it('the dark page palette is the app dark palette (one dark look across the site)', () => {
    expect(resolve(dark, '--page-canvas')).toBe(resolve(dark, '--app-bg'));
    expect(resolve(dark, '--page-parchment')).toBe(resolve(dark, '--app-surface'));
    expect(resolve(dark, '--page-ink')).toBe(resolve(dark, '--app-ink'));
    expect(resolve(dark, '--page-muted-48')).toBe(resolve(dark, '--app-muted'));
    expect(resolve(dark, '--page-hairline')).toBe(resolve(dark, '--app-hairline'));
    expect(resolve(dark, '--page-link')).toBe(resolve(dark, '--app-link'));
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
    const allowed = new Set(['--color-primary', '--color-primary-focus', '--color-primary-on-dark', '--color-primary-fill', '--error-ink', '--error-ink-on-dark', '--app-link', '--app-focus', '--app-error', '--page-link', '--page-focus']);
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

describe('stylesheets use tokens only', () => {
  const files = ['src/ui/global.css', 'src/ui/chrome.css', 'src/landing/landing.css', 'src/legal/legal.css', 'src/support/support.css', 'src/architecture/architecture.css'];
  it.each(files)('%s has no colour literal and no font-weight 500', (f) => {
    const body = readFileSync(join(__dirname, '..', '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    expect(body).not.toMatch(/font-weight:\s*500/);
  });

  it('every app button presses to 0.95 through Motion (app-motion-ux), with no competing CSS press', () => {
    const g = readFileSync(join(__dirname, '..', '..', 'src/ui/global.css'), 'utf8');
    expect(g).not.toMatch(/button:active/);
    expect(g).not.toMatch(/button[^{]*\{[^}]*transition: transform/);
    const ui = join(__dirname, '..', '..', 'src/ui');
    for (const f of ['App.tsx', 'CreateFlow.tsx', 'UnlockFlow.tsx', 'VaultView.tsx', 'components.tsx', 'motionkit.tsx']) {
      const src = readFileSync(join(ui, f), 'utf8');
      expect(src, f).not.toMatch(/<button\b/); // all buttons are <Btn> (m.button + whileTap)
    }
    expect(readFileSync(join(ui, 'motionkit.tsx'), 'utf8')).toMatch(/whileTap: TAP/);
    expect(g).toMatch(/scroll-padding-bottom/);
    // fix-floating-bar-focus: the padding is derived from the bar's real geometry (rows of 44px targets, its padding,
    // border and sticky offset), and stacked phone bars raise the row count.
    expect(g).toMatch(/scroll-padding-bottom:\s*var\(--bar-footprint\)/);
    expect(g).toMatch(/--bar-footprint:\s*calc\([^;]*var\(--bar-rows\)[^;]*var\(--target\)/);
    for (const n of [2, 3, 4]) expect(g).toMatch(new RegExp(`html:has\\(\\.action-bar > :nth-child\\(${n}\\)\\)\\s*\\{\\s*--bar-rows:\\s*${n}`));
    expect(g).not.toMatch(/dashed/); // disabled pills keep the guide's solid pill shape
    expect(g).toMatch(/\.card \.action-bar \{[^}]*background: none[^}]*border: 0/);
  });
});

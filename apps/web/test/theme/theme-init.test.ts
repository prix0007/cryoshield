/**
 * add-theme-switch 1.1 (spec site-theme "Theme applies before first paint", "Theme preference storage"): the real
 * classic script, evaluated as the browser would (no module scope), against jsdom.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { themeAsset } from '../../vite-plugins/theme';

const SRC = readFileSync(join(__dirname, '..', '..', 'src', 'theme', 'theme-init.js'), 'utf8');
const KEY = 'cryoshield-theme';
const root = () => document.documentElement;
// Every behaviour is checked on the source (served in dev) AND on the minified bytes the build ships.
const VARIANTS: [string, string][] = [
  ['source', SRC],
  ['shipped (minified)', themeAsset(SRC).source],
];
let CODE = SRC;

/** Runs the script like a classic <script> in <head> would. */
function run() {
  new Function(CODE)();
}

function switchMarkup(hidden = true) {
  return `<div class="theme-switch" data-theme-switch${hidden ? ' hidden' : ''}><label for="theme-select">Theme</label><select id="theme-select" data-theme-select><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></div>`;
}

function choose(select: HTMLSelectElement, value: string) {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

const listeners: [EventTarget, string, EventListenerOrEventListenerObject][] = [];
beforeEach(() => {
  localStorage.clear();
  delete root().dataset.theme;
  document.body.innerHTML = '';
  // Track listeners the script adds, so each test starts from a clean document.
  for (const target of [document, window] as EventTarget[]) {
    const add = target.addEventListener.bind(target);
    vi.spyOn(target, 'addEventListener').mockImplementation(
      (type: string, fn: EventListenerOrEventListenerObject | null, opts?: boolean | AddEventListenerOptions) => {
        if (fn) listeners.push([target, type, fn]);
        add(type, fn, opts);
      },
    );
  }
});
afterEach(() => {
  for (const [t, type, fn] of listeners.splice(0)) t.removeEventListener(type, fn);
  vi.restoreAllMocks();
});

describe.each(VARIANTS)('%s', (_name, code) => {
  beforeEach(() => {
    CODE = code;
  });

  describe('theme-init.js: before first paint', () => {
    it.each(['light', 'dark'])('applies a saved "%s" to <html data-theme>', (v) => {
      localStorage.setItem(KEY, v);
      run();
      expect(root().dataset.theme).toBe(v);
    });

    it('leaves data-theme unset for System (no key)', () => {
      root().dataset.theme = 'dark'; // stale attribute must not survive
      run();
      expect(root().hasAttribute('data-theme')).toBe(false);
    });

    it.each(['system', 'DARK', 'dark ', '"><img>', ''])('ignores an invalid saved value %j (System)', (v) => {
      localStorage.setItem(KEY, v);
      run();
      expect(root().hasAttribute('data-theme')).toBe(false);
    });

    it('falls back to System when reading storage throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError');
      });
      expect(() => run()).not.toThrow();
      expect(root().hasAttribute('data-theme')).toBe(false);
    });

    it('falls back to System when localStorage itself is inaccessible', () => {
      vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError');
      });
      expect(() => run()).not.toThrow();
      expect(root().hasAttribute('data-theme')).toBe(false);
    });

    it('uses no HTML sink, eval or inline style (CSP / Trusted Types)', () => {
      expect(SRC).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|\.style\b|setAttribute\(\s*['"]style/);
      expect(SRC).not.toMatch(/sessionStorage|indexedDB|document\.cookie|fetch\(|XMLHttpRequest|sendBeacon/);
    });
  });

  describe('theme-init.js: the switch', () => {
    it('a change applies the theme, saves it and syncs every switch; System removes the key', () => {
      document.body.innerHTML = switchMarkup(false) + switchMarkup(false).replace('id="theme-select"', 'id="theme-select-2"');
      run();
      const [a, b] = [...document.querySelectorAll<HTMLSelectElement>('select[data-theme-select]')];
      choose(a!, 'dark');
      expect(root().dataset.theme).toBe('dark');
      expect(localStorage.getItem(KEY)).toBe('dark');
      expect(b!.value).toBe('dark');
      choose(b!, 'light');
      expect(root().dataset.theme).toBe('light');
      expect(localStorage.getItem(KEY)).toBe('light');
      expect(a!.value).toBe('light');
      choose(a!, 'system');
      expect(root().hasAttribute('data-theme')).toBe(false);
      expect(localStorage.getItem(KEY)).toBeNull();
      expect(Object.keys(localStorage)).toEqual([]);
    });

    it('works for a switch rendered after the script ran (the React app): event delegation', () => {
      run();
      document.body.innerHTML = switchMarkup(false);
      choose(document.querySelector<HTMLSelectElement>('select[data-theme-select]')!, 'dark');
      expect(root().dataset.theme).toBe('dark');
      expect(localStorage.getItem(KEY)).toBe('dark');
    });

    it('ignores change events from other selects', () => {
      document.body.innerHTML = '<select id="other"><option value="dark">Dark</option></select>';
      run();
      choose(document.querySelector<HTMLSelectElement>('#other')!, 'dark');
      expect(root().hasAttribute('data-theme')).toBe(false);
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it('ignores an unknown option value', () => {
      document.body.innerHTML = switchMarkup(false);
      run();
      const s = document.querySelector<HTMLSelectElement>('select[data-theme-select]')!;
      s.add(new Option('Sepia', 'sepia'));
      choose(s, 'sepia');
      expect(root().hasAttribute('data-theme')).toBe(false);
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it('still applies the theme to the open page when saving throws', () => {
      document.body.innerHTML = switchMarkup(false);
      run();
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError');
      });
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError');
      });
      const s = document.querySelector<HTMLSelectElement>('select[data-theme-select]')!;
      expect(() => choose(s, 'dark')).not.toThrow();
      expect(root().dataset.theme).toBe('dark');
      expect(() => choose(s, 'system')).not.toThrow();
      expect(root().hasAttribute('data-theme')).toBe(false);
    });

    it('on DOMContentLoaded, sets each switch to the current choice and unhides it', () => {
      localStorage.setItem(KEY, 'dark');
      Object.defineProperty(document, 'readyState', {
        configurable: true,
        get: () => 'loading',
      });
      try {
        run();
        document.body.innerHTML = switchMarkup(true);
        const wrap = document.querySelector<HTMLElement>('[data-theme-switch]')!;
        expect(wrap.hidden).toBe(true);
        document.dispatchEvent(new Event('DOMContentLoaded'));
        expect(wrap.hidden).toBe(false);
        expect(document.querySelector<HTMLSelectElement>('select[data-theme-select]')!.value).toBe('dark');
      } finally {
        delete (document as unknown as Record<string, unknown>).readyState;
      }
    });

    it('when the document is already parsed, wires the switches at once', () => {
      document.body.innerHTML = switchMarkup(true);
      localStorage.setItem(KEY, 'light');
      run();
      expect(document.querySelector<HTMLElement>('[data-theme-switch]')!.hidden).toBe(false);
      expect(document.querySelector<HTMLSelectElement>('select[data-theme-select]')!.value).toBe('light');
    });

    it('a storage event from another tab re-applies the saved choice', () => {
      document.body.innerHTML = switchMarkup(false);
      run();
      localStorage.setItem(KEY, 'dark');
      window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: 'dark' }));
      expect(root().dataset.theme).toBe('dark');
      expect(document.querySelector<HTMLSelectElement>('select[data-theme-select]')!.value).toBe('dark');
      localStorage.removeItem(KEY);
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
      expect(root().hasAttribute('data-theme')).toBe(false);
      expect(document.querySelector<HTMLSelectElement>('select[data-theme-select]')!.value).toBe('system');
    });

    it('stores nothing until the visitor chooses', () => {
      document.body.innerHTML = switchMarkup(true);
      run();
      expect(Object.keys(localStorage)).toEqual([]);
    });
  });

  // Review M2: the browser chrome colour (theme-color) follows a forced choice; System restores the per-scheme metas.
  describe('theme-init.js: theme-color metas', () => {
    const metas = () => [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((m) => [m.getAttribute('media'), m.content]);
    const DEFAULTS = [
      ['(prefers-color-scheme: light)', '#ffffff'],
      ['(prefers-color-scheme: dark)', '#000000'],
    ];
    beforeEach(() => {
      document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
      for (const [media, content] of DEFAULTS) {
        const m = document.createElement('meta');
        m.name = 'theme-color';
        m.setAttribute('media', media!); // jsdom has no `media` IDL attribute on <meta>
        m.content = content!;
        document.head.append(m);
      }
    });
    afterEach(() => document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove()));

    it.each([
      ['dark', '#000000'],
      ['light', '#ffffff'],
    ])('a saved %s sets every theme-color meta to %s before paint', (v, colour) => {
      localStorage.setItem(KEY, v);
      run();
      expect(metas()).toEqual(DEFAULTS.map(([media]) => [media, colour]));
    });

    it('System leaves the per-scheme metas untouched, and choosing System after a forced theme restores them', () => {
      document.body.innerHTML = switchMarkup(false);
      run();
      expect(metas()).toEqual(DEFAULTS);
      const s = document.querySelector<HTMLSelectElement>('select[data-theme-select]')!;
      choose(s, 'dark');
      expect(metas()).toEqual(DEFAULTS.map(([media]) => [media, '#000000']));
      choose(s, 'light');
      expect(metas()).toEqual(DEFAULTS.map(([media]) => [media, '#ffffff']));
      choose(s, 'system');
      expect(metas()).toEqual(DEFAULTS);
    });

    it('a page without theme-color metas still works', () => {
      document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
      localStorage.setItem(KEY, 'dark');
      expect(() => run()).not.toThrow();
      expect(root().dataset.theme).toBe('dark');
    });
  });
});

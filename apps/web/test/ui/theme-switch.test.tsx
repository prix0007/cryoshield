/**
 * add-theme-switch 1.4 (spec site-theme "Theme choice on every page"; app-visual-design "Navigation chrome"): the
 * switch in the app's GlobalNav and in the static headers (landing page and the shared legal/architecture partial).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GlobalNav } from '../../src/ui/chrome';

const web = join(__dirname, '..', '..');
const OPTIONS = [
  ['system', 'System'],
  ['light', 'Light'],
  ['dark', 'Dark'],
];

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

function expectSwitch(select: HTMLSelectElement) {
  expect(select.matches('select[data-theme-select]')).toBe(true);
  expect([...select.options].map((o) => [o.value, o.textContent])).toEqual(OPTIONS);
}

describe('app GlobalNav theme switch', () => {
  it('renders a "Theme" combobox with System, Light and Dark inside the site navigation', () => {
    render(<GlobalNav />);
    const nav = screen.getByRole('navigation', { name: 'Site' });
    const select = within(nav).getByRole('combobox', { name: 'Theme' }) as HTMLSelectElement;
    expectSwitch(select);
    expect(select.closest('[data-theme-switch]')).not.toBeNull();
    expect(select.closest('[data-theme-switch]')!.hasAttribute('hidden')).toBe(false);
  });

  it.each([
    [undefined, 'system'],
    ['light', 'light'],
    ['dark', 'dark'],
  ])('starts from <html data-theme=%s> (%s)', (attr, value) => {
    if (attr) document.documentElement.dataset.theme = attr;
    render(<GlobalNav />);
    expect((screen.getByRole('combobox', { name: 'Theme' }) as HTMLSelectElement).value).toBe(value);
  });

  it('is uncontrolled (the theme script owns changes; React never resets it)', () => {
    const src = readFileSync(join(web, 'src', 'ui', 'chrome.tsx'), 'utf8');
    expect(src).toMatch(/defaultValue=/);
    expect(src).not.toMatch(/localStorage|sessionStorage/);
  });
});

describe('static headers carry the same switch, hidden until the theme script runs', () => {
  const files = ['index.html', 'legal/partials/header.html'];
  it.each(files)('%s', (f) => {
    const doc = new DOMParser().parseFromString(readFileSync(join(web, f), 'utf8'), 'text/html');
    const navs = doc.querySelectorAll('nav.global-nav');
    expect(navs).toHaveLength(1);
    const wraps = navs[0]!.querySelectorAll('[data-theme-switch]');
    expect(wraps).toHaveLength(1);
    expect(wraps[0]!.hasAttribute('hidden')).toBe(true);
    const select = wraps[0]!.querySelector('select') as HTMLSelectElement;
    expectSwitch(select);
    const label = doc.querySelector(`label[for="${select.id}"]`);
    expect(label?.textContent?.trim()).toBe('Theme');
    // Before the narrow-width menu, after the links (reading and tab order).
    const inner = navs[0]!.querySelector('.global-nav-inner')!;
    const kids = [...inner.children];
    expect(kids.indexOf(wraps[0] as Element)).toBeGreaterThan(kids.findIndex((k) => k.classList.contains('global-nav-links')));
    expect(kids.indexOf(wraps[0] as Element)).toBeLessThan(kids.findIndex((k) => k.classList.contains('nav-menu')));
  });
});

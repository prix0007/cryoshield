/**
 * add-theme-switch 1.6 (spec site-theme): the theme switch on every page, applied before the first paint, remembered
 * in one fail-safe key, System following the device, and axe (colour contrast included) in forced Light and forced
 * Dark on the landing page, every public page, the app home, an open vault, the vault list and the secrets editor.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { APP, LANDING } from '../fixtures/routes';
import { ArweaveStub } from '../fixtures/arweave';
import { VirtualKeys } from '../fixtures/webauthn';
import { createVault } from '../fixtures/app';
import { settled } from '../fixtures/motion';

const KEY = 'cryoshield-theme';
const PAGES = [LANDING, APP, '/architecture', '/devices', '/support', '/privacy', '/terms', '/cookies'];
const THEMES = ['light', 'dark'] as const;

const themeSelect = (page: Page) => page.getByRole('navigation', { name: 'Site' }).getByRole('combobox', { name: 'Theme' });
const themeAttr = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
const storage = (page: Page) => page.evaluate(() => ({ ...localStorage }));
const bodyBg = (page: Page, sel = 'body') => page.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor);

async function axe(page: Page, screen: string) {
  await settled(page);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${screen}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  // The colour-contrast rule really ran (it is part of wcag2aa) and checked something.
  expect([...r.passes, ...r.incomplete, ...r.violations].some((x) => x.id === 'color-contrast'), `${screen}: color-contrast ran`).toBe(true);
}

async function choose(page: Page, theme: 'system' | 'light' | 'dark') {
  await themeSelect(page).selectOption(theme);
  if (theme === 'system') await expect.poll(() => themeAttr(page)).toBeNull();
  else await expect.poll(() => themeAttr(page)).toBe(theme);
}

test('the switch is on every page: labelled, 44px tall, System by default, and no horizontal scroll at 320/390/1280', async ({ page }) => {
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const p of PAGES) {
      await page.goto(p);
      const s = themeSelect(page);
      await expect(s, `${p} @${width}`).toBeVisible();
      await expect(s).toHaveValue('system');
      expect(await s.locator('option').allTextContents()).toEqual(['System', 'Light', 'Dark']);
      const box = (await s.boundingBox())!;
      expect(box.height, `${p} @${width} height`).toBeGreaterThanOrEqual(44);
      expect(box.width, `${p} @${width} width`).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width, `${p} @${width} inside the viewport`).toBeLessThanOrEqual(width - 8);
      const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(sw, `${p} @${width} horizontal scroll`).toBeLessThanOrEqual(cw);
    }
  }
  expect(await storage(page)).toEqual({}); // nothing stored until a visitor chooses
});

test('keyboard: Tab reaches the switch with a visible focus ring, and choosing Dark applies at once', async ({ page }) => {
  await page.goto('/privacy');
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => (document.activeElement as HTMLElement | null)?.id === 'theme-select')) break;
  }
  const ring = await page.evaluate(() => {
    const cs = getComputedStyle(document.activeElement!);
    return { id: document.activeElement!.id, style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
  });
  expect(ring).toEqual({ id: 'theme-select', style: 'solid', width: 2 });
  await page.keyboard.type('D'); // type-ahead selects "Dark" on a focused, closed select (every platform)
  await expect.poll(() => themeAttr(page)).toBe('dark');
  await expect(themeSelect(page)).toBeFocused(); // focus stays on the switch: nothing re-renders it away
  expect(await bodyBg(page)).toBe('rgb(0, 0, 0)');
});

test('the choice is remembered across pages and restored before the first paint; System deletes it', async ({ page }) => {
  // Records <html data-theme> at the moment <body> is inserted, i.e. before any body content can paint.
  await page.addInitScript(() => {
    const w = window as unknown as { __themeAtBody?: string | null };
    new MutationObserver((_m, obs) => {
      if (document.body) {
        w.__themeAtBody = document.documentElement.getAttribute('data-theme');
        obs.disconnect();
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto('/privacy');
  await choose(page, 'dark');
  expect(await storage(page)).toEqual({ [KEY]: 'dark' });
  for (const p of PAGES) {
    await page.goto(p);
    expect(await page.evaluate(() => (window as unknown as { __themeAtBody?: string | null }).__themeAtBody), `${p} before paint`).toBe('dark');
    await expect(themeSelect(page), p).toHaveValue('dark');
  }
  await choose(page, 'light');
  expect(await storage(page)).toEqual({ [KEY]: 'light' });
  await page.goto(APP);
  expect(await page.evaluate(() => (window as unknown as { __themeAtBody?: string | null }).__themeAtBody)).toBe('light');
  await choose(page, 'system');
  expect(await storage(page)).toEqual({});
});

test('System follows the device; a forced choice beats it', async ({ page }) => {
  for (const p of ['/privacy', APP, LANDING]) {
    const surface = p === APP ? 'body' : p === LANDING ? '#hero' : 'main';
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(p);
    expect(await themeAttr(page)).toBeNull();
    expect(await bodyBg(page, surface), `${p} system/dark`).toBe('rgb(0, 0, 0)');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => bodyBg(page, surface), `${p} system/light`).not.toBe('rgb(0, 0, 0)');
    await choose(page, 'dark'); // device light, forced dark
    expect(await bodyBg(page, surface), `${p} forced dark`).toBe('rgb(0, 0, 0)');
    await page.emulateMedia({ colorScheme: 'dark' });
    await choose(page, 'light'); // device dark, forced light
    expect(await bodyBg(page, surface), `${p} forced light`).not.toBe('rgb(0, 0, 0)');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');
    await choose(page, 'system');
  }
});

test('storage that throws falls back to System, the switch still themes the open page, and nothing breaks', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    for (const m of ['getItem', 'setItem', 'removeItem'] as const) {
      Storage.prototype[m] = () => {
        throw new DOMException('blocked', 'SecurityError');
      };
    }
  });
  for (const p of ['/privacy', APP]) {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(p);
    expect(await themeAttr(page)).toBeNull();
    await expect(themeSelect(page)).toHaveValue('system');
    await choose(page, 'dark');
    expect(await bodyBg(page)).toBe('rgb(0, 0, 0)');
    await choose(page, 'system');
  }
  expect(errors).toEqual([]);
});

test('a tampered value is ignored (System), and the preference is never sent anywhere', async ({ page, baseURL }) => {
  const sent: string[] = [];
  page.on('request', (r) => sent.push(`${r.url()} ${JSON.stringify(r.headers())} ${r.postData() ?? ''}`));
  await page.goto('/privacy');
  await page.evaluate((k) => localStorage.setItem(k, '"><img src=x>'), KEY);
  await page.reload();
  expect(await themeAttr(page)).toBeNull();
  await expect(themeSelect(page)).toHaveValue('system');
  expect(await page.locator('img[src="x"]').count()).toBe(0);
  await choose(page, 'dark');
  for (const p of PAGES) await page.goto(p);
  for (const s of sent) expect(s, s.slice(0, 120)).not.toContain('cryoshield-theme');
  for (const s of sent.filter((x) => x.startsWith(baseURL!))) expect(s).not.toMatch(/theme=dark|"dark"/);
});

for (const theme of THEMES) {
  test(`axe (colour contrast included) in forced ${theme}: every public page`, async ({ page }) => {
    // The opposite device scheme, so the forced choice (not the media query) is what is audited.
    await page.emulateMedia({ colorScheme: theme === 'dark' ? 'light' : 'dark' });
    await page.goto('/privacy');
    await choose(page, theme);
    for (const p of [LANDING, '/architecture', '/devices', '/support', '/privacy', '/terms', '/cookies']) {
      await page.goto(p);
      expect(await themeAttr(page)).toBe(theme);
      await axe(page, `${theme} ${p}`);
    }
    // The landing page at phone width and with its scenes played through (final key frames).
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(LANDING);
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight / 2) {
        scrollTo({ top: y, behavior: 'instant' });
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
    });
    await axe(page, `${theme} landing 390 scrolled`);
  });

  test(`axe (colour contrast included) in forced ${theme}: app home, open vault, vault list, editor`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.emulateMedia({ colorScheme: theme === 'dark' ? 'light' : 'dark' });
    const arweave = new ArweaveStub();
    await arweave.install(page);
    await page.goto(APP);
    await choose(page, theme);
    const keys = await VirtualKeys.attach(page);
    await keys.add();
    await keys.add();
    await axe(page, `${theme} app home`);
    await createVault(page, keys, [
      { label: 'Seed', secret: 'abandon abandon art' },
      { label: 'Email', secret: 'JBSWY3DPEHPK3PXP' },
    ]);
    await axe(page, `${theme} saved`);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Seed' })).toBeVisible({ timeout: 30_000 });
    expect(await themeAttr(page)).toBe(theme);
    await axe(page, `${theme} open vault`);
    await page.getByRole('button', { name: /^All vaults/ }).click();
    await expect(page.getByRole('heading', { name: 'Your vaults', level: 1 })).toBeVisible({ timeout: 15_000 });
    await axe(page, `${theme} vault list`);
    await page.getByRole('button', { name: 'Back to the vault' }).click();
    await page.getByRole('button', { name: 'Edit secrets' }).click();
    await expect(page.getByRole('heading', { name: 'Edit secrets' })).toBeVisible();
    await axe(page, `${theme} editor`);
  });
}

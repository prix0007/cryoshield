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

test('review L1: 320px on a touch phone (coarse pointer, 16px select text) fits on every page with no horizontal scroll', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  for (const p of PAGES) {
    await page.goto(p);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'coarse pointer').toBe(true);
    const s = themeSelect(page);
    await expect(s).toBeVisible();
    expect(await s.evaluate((e) => getComputedStyle(e).fontSize)).toBe('16px');
    const box = (await s.boundingBox())!;
    expect(box.x + box.width, `${p} switch inside the viewport`).toBeLessThanOrEqual(320);
    const glyph = (await page.locator('.global-nav .wordmark-glyph').boundingBox())!;
    expect(glyph.width, `${p} wordmark glyph not squeezed`).toBeGreaterThanOrEqual(18);
    const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(sw, `${p} horizontal scroll`).toBeLessThanOrEqual(cw);
  }
  await ctx.close();
});

test('review L2: in forced-colors mode the switch keeps a 44px target and a visible system-colour border', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  for (const p of ['/privacy', APP]) {
    await page.goto(p);
    const s = themeSelect(page);
    const box = (await s.boundingBox())!;
    expect(box.height, p).toBeGreaterThanOrEqual(44);
    const st = await s.evaluate((e) => {
      const cs = getComputedStyle(e);
      return { outline: cs.outlineStyle, offset: parseFloat(cs.outlineOffset), width: parseFloat(cs.outlineWidth) };
    });
    // The visible boundary is an outline drawn inside the transparent border (box-shadows are dropped in forced colours).
    expect(st.outline, p).toBe('solid');
    expect(st.width, p).toBeGreaterThanOrEqual(1);
    expect(st.offset, p).toBeLessThan(0);
  }
});

test('review L4: the switch reserves its space before the script runs (no layout shift), but is not shown or focusable', async ({ browser }) => {
  const xOf = async (javaScriptEnabled: boolean) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, javaScriptEnabled });
    const page = await ctx.newPage();
    await page.goto('/privacy');
    const r = {
      links: (await page.locator('.global-nav-links').boundingBox())!.x,
      switchW: (await page.locator('[data-theme-switch]').boundingBox())?.width ?? 0,
      visible: await page.locator('[data-theme-switch]').isVisible(),
    };
    await ctx.close();
    return r;
  };
  const off = await xOf(false);
  const on = await xOf(true);
  expect(off.visible).toBe(false); // hidden without the script
  expect(on.visible).toBe(true);
  expect(off.switchW).toBeGreaterThan(0); // space reserved
  expect(off.links).toBe(on.links); // the nav links do not move when the switch appears
});

test('review M2: the theme-color metas follow a forced choice; System restores the per-scheme colours', async ({ page }) => {
  const metas = () => page.locator('meta[name="theme-color"]').evaluateAll((ms) => ms.map((m) => [m.getAttribute('media'), (m as HTMLMetaElement).content]));
  await page.goto('/privacy');
  const defaults = await metas();
  expect(defaults).toEqual([
    ['(prefers-color-scheme: light)', '#ffffff'],
    ['(prefers-color-scheme: dark)', '#000000'],
  ]);
  await choose(page, 'dark');
  expect((await metas()).map((m) => m[1])).toEqual(['#000000', '#000000']);
  await page.goto(APP); // restored before paint on the next page too
  expect((await metas()).map((m) => m[1])).toEqual(['#000000', '#000000']);
  await choose(page, 'light');
  expect((await metas()).map((m) => m[1])).toEqual(['#ffffff', '#ffffff']);
  await choose(page, 'system');
  expect(await metas()).toEqual(defaults);
});

test('review L6: /architecture highlighted labels are >= 4.5:1 on their box in forced Light and Dark', async ({ page }) => {
  await page.goto('/architecture');
  for (const theme of THEMES) {
    await choose(page, theme);
    // The label colour against the highlight box composited over the figure background.
    const ratio = await page.evaluate(() => {
      const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
      };
      const text = parse(getComputedStyle(document.querySelector('.arch-hl-text')!).fill);
      const [r, g, b, a = 1] = parse(getComputedStyle(document.querySelector('.arch-hl')!).fill);
      const fig = parse(getComputedStyle(document.querySelector('.arch-doc figure')!).backgroundColor);
      const box = [r!, g!, b!].map((v, i) => a * v + (1 - a) * fig[i]!);
      const [x, y] = [lum(text), lum(box)].sort((p, q) => q - p);
      return (x! + 0.05) / (y! + 0.05);
    });
    expect(ratio, theme).toBeGreaterThanOrEqual(4.5);
  }
});

test('review H1: the Copy chip (white on blue) passes axe colour contrast in forced Light and Dark', async ({ page, context }) => {
  test.setTimeout(240_000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const arweave = new ArweaveStub();
  await arweave.install(page);
  await page.goto(APP);
  const keys = await VirtualKeys.attach(page);
  await keys.add();
  await keys.add();
  await createVault(page, keys, [{ label: 'Seed', secret: 'correct horse battery staple' }]);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Seed' })).toBeVisible({ timeout: 30_000 });
  // One Copy (a second one re-pops the chip mid-audit); the chip stays for the clipboard countdown while the theme flips.
  await page.getByRole('button', { name: 'Copy Seed' }).click();
  for (const theme of THEMES) {
    await choose(page, theme);
    await expect(page.locator('.copy-chip')).toHaveCount(1);
    await expect(page.locator('.copy-chip')).toBeVisible();
    await settled(page);
    // Audit the settled chip, not a frame of its pop-in (Motion fades it in).
    await expect
      .poll(() =>
        page.locator('.copy-chip').evaluate((e) => {
          let o = 1;
          for (let n: Element | null = e; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
          return o;
        }),
      )
      .toBe(1);
    const r = await new AxeBuilder({ page }).include('.copy-feedback').withRules(['color-contrast']).analyze();
    expect(r.violations.flatMap((v) => v.nodes.map((n) => `${theme}: ${v.id} ${n.target.join(' ')} ${n.failureSummary}`))).toEqual([]);
    expect(r.passes.some((p) => p.id === 'color-contrast'), `${theme}: the chip text was checked`).toBe(true);
  }
});

for (const theme of THEMES) {
  test(`add-landing-breaches 1.3: the breaches tile passes axe in forced ${theme} at 1280 and 390 px, one column on a phone`, async ({ page }) => {
    // The opposite device scheme, so the forced choice (not the media query) is what is audited.
    await page.emulateMedia({ colorScheme: theme === 'dark' ? 'light' : 'dark' });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(LANDING);
    await choose(page, theme);
    const tile = page.locator('#breaches');
    const audit = async (label: string) => {
      await tile.scrollIntoViewIfNeeded();
      const r = await new AxeBuilder({ page }).include('#breaches').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      expect(r.violations.map((v) => `${label}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      expect(r.passes.some((x) => x.id === 'color-contrast'), `${label}: color-contrast checked something`).toBe(true);
    };
    const lefts = () => tile.locator('.breach-card').evaluateAll((cs) => cs.map((c) => Math.round(c.getBoundingClientRect().left)));
    // The tile follows the theme: the parchment surface is #1d1d1f in Dark and light in Light.
    const bg = await tile.evaluate((e) => getComputedStyle(e).backgroundColor);
    if (theme === 'dark') expect(bg).toBe('rgb(29, 29, 31)');
    else expect(bg).not.toBe('rgb(29, 29, 31)');
    expect(new Set(await lefts()).size, 'three columns on desktop').toBe(3);
    await audit(`${theme} 1280`);
    await page.setViewportSize({ width: 390, height: 844 });
    await audit(`${theme} 390`);
    expect(new Set(await lefts()).size, 'one column on a phone').toBe(1);
    const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(sw, 'no horizontal scroll at 390').toBeLessThanOrEqual(cw);
    for (const right of await tile.locator('.breach-card').evaluateAll((cs) => cs.map((c) => c.getBoundingClientRect().right))) expect(right).toBeLessThanOrEqual(390);
  });

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

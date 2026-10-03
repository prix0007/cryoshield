/** add-architecture-page 1.2 (spec architecture-page): render, axe in light and dark, phone reflow, focusable figures. */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const scheme of ['light', 'dark'] as const) {
  test(`/architecture renders and passes axe in ${scheme} mode`, async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.goto('/architecture');
    await expect(page.getByRole('heading', { level: 1, name: 'CryoShield system map' })).toBeVisible();
    await expect(page.getByRole('img')).toHaveCount(3);
    await expect(page.locator('.sub-nav-name')).toHaveText('System design');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe(scheme === 'dark' ? 'rgb(29, 29, 31)' : 'rgb(255, 255, 255)');
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(r.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    for (const u of requests) if (!u.startsWith('data:')) expect(new URL(u).origin).toBe(new URL(baseURL!).origin);
    await ctx.close();
  });
}

test('/architecture at 390 px: no page-level horizontal scroll; wide figures scroll in focusable containers', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/architecture');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const scrollers = page.locator('.arch-scroll');
  await expect(scrollers).toHaveCount(3);
  for (const s of await scrollers.all()) {
    expect(await s.getAttribute('tabindex')).toBe('0');
    expect(await s.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
  }
  await scrollers.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => scrollers.first().evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
});

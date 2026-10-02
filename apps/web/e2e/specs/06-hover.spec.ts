/** cinematic-landing 1.1 (spec app-visual-design "Link decoration"): chrome links and pills never underline. */
import { expect, test, type Page } from '@playwright/test';
import { APP, LANDING } from '../fixtures/routes';

async function hoverAll(page: Page, selector: string) {
  const items = page.locator(selector);
  const n = await items.count();
  expect(n, selector).toBeGreaterThan(0);
  const bad: string[] = [];
  for (let i = 0; i < n; i++) {
    const el = items.nth(i);
    if (!(await el.isVisible())) continue;
    await el.scrollIntoViewIfNeeded();
    await el.hover();
    const deco = await el.evaluate((e) => {
      // The element and every descendant carrying text.
      const nodes = [e, ...e.querySelectorAll('*')];
      return nodes.map((x) => getComputedStyle(x).textDecorationLine).filter((d) => d !== 'none');
    });
    if (deco.length) bad.push(`${await el.evaluate((e) => e.outerHTML.slice(0, 80))}: ${deco.join(',')}`);
  }
  expect(bad).toEqual([]);
}

test('landing: logo, nav links, footer links and pills never underline on hover', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(LANDING);
  await hoverAll(page, '.wordmark');
  await hoverAll(page, '.global-nav-links a');
  await hoverAll(page, '.footer-links a');
  await hoverAll(page, 'a.pill');
});

test('landing: inline body-copy links are underlined at rest', async ({ page }) => {
  await page.goto(LANDING);
  const inline = page.locator('main p a:not(.pill)');
  const n = await inline.count();
  for (let i = 0; i < n; i++) {
    expect(await inline.nth(i).evaluate((e) => getComputedStyle(e).textDecorationLine)).toBe('underline');
  }
});

test('app: logo, nav links and buttons never underline on hover', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(APP);
  await hoverAll(page, '.wordmark');
  await hoverAll(page, '.global-nav-links a');
  await hoverAll(page, 'main button');
});

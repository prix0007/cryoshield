/** redesign-landing-and-app-ui 5.1: documentation screenshots (run with SCREENSHOTS=1; skipped otherwise). */
import { expect, test } from '@playwright/test';
import { APP, LANDING } from '../fixtures/routes';
import { VirtualKeys } from '../fixtures/webauthn';

test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to refresh apps/web/docs/screenshots');
const dir = 'docs/screenshots';

test('landing: desktop, phone, reduced motion', async ({ browser }) => {
  for (const [name, width, height, reducedMotion] of [
    ['landing-desktop', 1280, 800, 'no-preference'],
    ['landing-phone', 375, 740, 'no-preference'],
    ['landing-reduced-motion', 1280, 800, 'reduce'],
  ] as const) {
    const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion });
    const page = await ctx.newPage();
    await page.goto(LANDING);
    for (let i = 0; i < 16; i++) {
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
    await ctx.close();
  }
});

test('app: home, ceremony, error, dark', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 760 });
  await page.goto(APP);
  const keys = await VirtualKeys.attach(page);
  await keys.add({ prf: false });
  await page.screenshot({ path: `${dir}/app-home.png` });
  await page.getByRole('button', { name: 'Create a new vault' }).click();
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('button', { name: 'Set up key 1' }).click(); // no user presence yet: the panel waits
  await expect(page.getByText('Touch your key')).toBeVisible();
  await page.screenshot({ path: `${dir}/app-touch-your-key.png` });
  await page.goto(APP);
  const keys2 = await VirtualKeys.attach(page);
  await keys2.add({ prf: false });
  await keys2.use(0);
  await page.getByRole('button', { name: 'Create a new vault' }).click();
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('button', { name: 'Set up key 1' }).click();
  await expect(page.getByRole('alert')).toContainText('Key not supported', { timeout: 15_000 });
  await page.screenshot({ path: `${dir}/app-key-not-supported.png` });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: `${dir}/app-key-not-supported-dark.png` });
});

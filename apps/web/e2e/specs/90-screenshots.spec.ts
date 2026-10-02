/** redesign-landing-and-app-ui 5.1, cinematic-landing 4.4: documentation screenshots (run with SCREENSHOTS=1; skipped otherwise). */
import { expect, test } from '@playwright/test';
import { APP, LANDING } from '../fixtures/routes';
import { VirtualKeys } from '../fixtures/webauthn';

test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to refresh apps/web/docs/screenshots');
const dir = 'docs/screenshots';

test('landing (cinematic-landing 4.4): hero, scene stills, reduced motion, phone', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(LANDING);
  await page.waitForTimeout(2600); // key docked, first pulse
  await page.screenshot({ path: `${dir}/landing-hero.png` });
  for (const id of ['fragile', 'how', 'stored', 'lose-a-key', 'survives', 'timeline']) {
    for (const f of [0.1, 0.5, 0.95]) {
      await page.evaluate(
        ([id, f]) => {
          const track = document.querySelector<HTMLElement>(`#${id} .scene-track`)!;
          const top = track.getBoundingClientRect().top + scrollY;
          window.scrollTo({ top: top + (track.offsetHeight - innerHeight) * (f as number), behavior: 'instant' });
        },
        [id, f] as const,
      );
      await page.waitForTimeout(350);
      await page.screenshot({ path: `${dir}/scene-${id}-${Math.round(f * 100)}.png` });
    }
  }
  // Sub-nav pair: light frosted over a light tile, dark frosted over a dark tile.
  for (const [name, id] of [['subnav-light', 'how'], ['subnav-dark', 'fragile']] as const) {
    await page.evaluate((id) => {
      const t = document.querySelector<HTMLElement>(`#${id} .scene-track`)!;
      window.scrollTo({ top: t.getBoundingClientRect().top + scrollY + 300, behavior: 'instant' });
    }, id);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${dir}/${name}.png`, clip: { x: 0, y: 0, width: 1280, height: 160 } });
  }
  await page.locator('#start').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/landing-final-cta.png` });
  await ctx.close();

  for (const [name, width, height, reducedMotion] of [
    ['landing-reduced-motion', 1280, 800, 'reduce'],
    ['landing-phone', 390, 844, 'no-preference'],
  ] as const) {
    const c = await browser.newContext({ viewport: { width, height }, reducedMotion });
    const p = await c.newPage();
    await p.goto(LANDING);
    for (let i = 0; i < 40; i++) {
      await p.mouse.wheel(0, 600);
      await p.waitForTimeout(60);
    }
    await p.waitForTimeout(800);
    await p.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
    await c.close();
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

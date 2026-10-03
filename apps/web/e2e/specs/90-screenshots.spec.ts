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

test('legal pages and the create acknowledgement (add-privacy-and-compliance)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const p of ['privacy', 'terms', 'cookies']) {
    await page.goto(`/${p}`);
    await page.screenshot({ path: `${dir}/legal-${p}.png`, fullPage: true });
  }
  await page.goto(APP);
  const keys = await VirtualKeys.attach(page);
  await keys.add();
  await keys.add();
  await page.getByRole('button', { name: 'Create a new vault' }).click();
  await page.getByRole('button', { name: 'Get started' }).click();
  await keys.use(0);
  await page.getByRole('button', { name: 'Set up key 1' }).click();
  await expect(page.getByText('Key 1 is ready.')).toBeVisible();
  await keys.use(1);
  await page.getByRole('button', { name: 'Set up key 2' }).click();
  await expect(page.getByText('Key 2 is ready.')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('#label-0').fill('Bitcoin seed');
  await page.locator('#secret-0').fill('abandon ability able about');
  await page.locator('.ack').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${dir}/app-acknowledgement.png` });
});

/** Screenshot-only mock page on the preview origin (so it loads the real served icon files), via a routed URL. */
async function showMock(page: import('@playwright/test').Page, html: string) {
  await page.route('**/__brand-preview', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto('/__brand-preview');
}

test('brand icon (add-brand-icon 2.3): tab mock in light and dark, icon at 16, 32 and 180 px', async ({ browser }) => {
  for (const scheme of ['light', 'dark'] as const) {
    const ctx = await browser.newContext({ viewport: { width: 640, height: 120 }, colorScheme: scheme });
    const page = await ctx.newPage();
    const bar = scheme === 'dark' ? '#202124' : '#dee1e6';
    const tab = scheme === 'dark' ? '#35363a' : '#ffffff';
    const ink = scheme === 'dark' ? '#e8eaed' : '#1f1f1f';
    await showMock(page, `<!doctype html><html><body style="margin:0;background:${bar};font:13px system-ui;color:${ink}">
      <div style="display:flex;gap:2px;padding:10px 10px 0">
        ${['CryoShield · Backups that outlive the drive', 'Your vault · CryoShield', 'Privacy policy · CryoShield']
          .map((t, i) => `<div style="display:flex;align-items:center;gap:8px;width:190px;height:34px;padding:0 12px;border-radius:8px 8px 0 0;background:${i === 1 ? tab : 'transparent'}"><img src="/favicon.svg" width="16" height="16" alt=""><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t}</span></div>`)
          .join('')}
      </div><div style="height:60px;background:${tab}"></div></body></html>`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}/brand-tabs-${scheme}.png` });
    await ctx.close();
  }
  const ctx = await browser.newContext({ viewport: { width: 520, height: 230 } });
  const page = await ctx.newPage();
  await showMock(page, `<!doctype html><html><body style="margin:0;padding:20px;background:#f5f5f7;font:12px system-ui;color:#1d1d1f;display:flex;gap:28px;align-items:flex-end">
    <figure style="margin:0;text-align:center"><img src="/favicon.svg" width="16" height="16" alt=""><figcaption>16 px</figcaption></figure>
    <figure style="margin:0;text-align:center"><img src="/favicon.svg" width="32" height="32" alt=""><figcaption>32 px</figcaption></figure>
    <figure style="margin:0;text-align:center"><img src="/favicon.svg" width="128" height="128" alt=""><figcaption>small drawing, enlarged</figcaption></figure>
    <figure style="margin:0;text-align:center"><img src="/apple-touch-icon.png" width="180" height="180" alt="" style="border-radius:40px"><figcaption>180 px (touch icon)</figcaption></figure>
  </body></html>`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/brand-icon-sizes.png` });
  await ctx.close();
});

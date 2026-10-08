/** redesign-landing-and-app-ui 5.1, cinematic-landing 4.4: documentation screenshots (run with SCREENSHOTS=1; skipped otherwise). */
import { expect, test } from '@playwright/test';
import { APP, LANDING } from '../fixtures/routes';
import { VirtualKeys } from '../fixtures/webauthn';
import { ArweaveStub } from '../fixtures/arweave';
import { createVault, unlockWith } from '../fixtures/app';

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
        ${['Permanent Backup for Seed Phrases & 2FA Codes · CryoShield', 'Your vault · CryoShield', 'Privacy policy · CryoShield']
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

test('"Only you can read it." tile (landing-only-you-can-read 2.2): desktop revealed and phone', async ({ browser }) => {
  for (const [name, width, height] of [['only-you-desktop', 1280, 900], ['only-you-phone', 390, 844]] as const) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    await page.goto(LANDING);
    await page.evaluate(() => {
      const t = document.querySelector('#only-you')!;
      window.scrollTo({ top: t.getBoundingClientRect().top + scrollY - innerHeight * 1.5, behavior: 'instant' });
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('#only-you')!.scrollIntoView({ behavior: 'instant' }));
    await page.waitForTimeout(1200);
    await page.locator('#only-you').screenshot({ path: `${dir}/${name}.png` });
    await ctx.close();
  }
});

test('system design page (add-architecture-page 2.2): light, dark and phone', async ({ browser }) => {
  for (const [name, width, height, colorScheme] of [
    ['architecture-light', 1280, 900, 'light'],
    ['architecture-dark', 1280, 900, 'dark'],
    ['architecture-phone', 390, 844, 'light'],
  ] as const) {
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme });
    const page = await ctx.newPage();
    await page.goto('/architecture');
    await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
    await ctx.close();
  }
});

test('app motion (app-motion-ux 4.3): mid-transition, key slots, real save checklist, reveal + copy, reduced motion', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1024, height: 860 });
  const arweave = new ArweaveStub();
  await arweave.install(page);
  // Hold the bundler's eth_sendUserOperation for a few seconds: the checklist then honestly shows a save that has
  // been encrypted and sponsored but not yet accepted by the bundler.
  let hold = true;
  await page.route('http://127.0.0.1:4337/**', async (route) => {
    if (hold && (route.request().postData() ?? '').includes('eth_sendUserOperation')) await new Promise((r) => setTimeout(r, 4_000));
    await route.continue();
  });
  await page.goto(APP);
  const keys = await VirtualKeys.attach(page);
  await keys.add();
  await keys.add();
  await page.getByRole('button', { name: 'Create a new vault' }).click();
  await page.waitForTimeout(90);
  await page.screenshot({ path: `${dir}/motion-step-mid-transition.png` });
  await page.getByRole('button', { name: 'Get started' }).click();
  await keys.use(0);
  await page.getByRole('button', { name: 'Set up key 1' }).click();
  await expect(page.getByText('Key 1 is ready.')).toBeVisible();
  await keys.use(1);
  await page.getByRole('button', { name: 'Set up key 2' }).click();
  await expect(page.getByText('Key 2 is ready.')).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/motion-key-slots.png` });
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('#label-0').fill('Bitcoin seed');
  await page.locator('#secret-0').fill('abandon ability able about');
  await page.getByRole('checkbox', { name: /published permanently/ }).check();
  await page.getByRole('checkbox', { name: 'I am 18 or over.' }).check();
  await keys.use(0);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.stage-done').filter({ hasText: 'Network fee sponsored' })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/motion-save-in-progress.png` });
  hold = false;
  await expect(page.getByText('Backup copy saved.')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${dir}/motion-save-complete.png` });

  await unlockWith(page, keys, 1);
  await page.getByRole('button', { name: 'Show Bitcoin seed' }).click();
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${dir}/motion-reveal-mid.png` });
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Copy Bitcoin seed' }).click();
  await page.waitForTimeout(3_000);
  await page.screenshot({ path: `${dir}/motion-copy-countdown.png` });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Edit secrets' }).click();
  await page.waitForTimeout(90);
  await page.screenshot({ path: `${dir}/motion-reduced-mid-transition.png` });
});

test('vault actions (vault-view-action-layout): Edit secrets, Manage vault, navigation; light and dark', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  const arweave = new ArweaveStub();
  await arweave.install(page);
  await page.goto(APP);
  const keys = await VirtualKeys.attach(page);
  await keys.add();
  await keys.add();
  await createVault(page, keys, [
    { label: 'Bitcoin seed', secret: 'abandon ability able about' },
    { label: 'GitHub recovery codes', secret: 'a1b2-c3d4' },
  ]);
  await page.getByRole('button', { name: 'Continue' }).click();
  const lock = page.getByRole('button', { name: 'Lock', exact: true });
  await expect(lock).toBeVisible();
  await page.waitForTimeout(600);
  await lock.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${dir}/app-vault-actions.png` });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/app-vault-actions-dark.png` });
});

test('supported devices page (add-supported-devices-page 4.x): light, dark, phone, and the app key error link', async ({ browser }) => {
  for (const [name, colorScheme, viewport] of [
    ['devices-light', 'light', { width: 1280, height: 900 }],
    ['devices-dark', 'dark', { width: 1280, height: 900 }],
    ['devices-phone', 'light', { width: 390, height: 844 }],
  ] as const) {
    const ctx = await browser.newContext({ colorScheme, viewport });
    const p = await ctx.newPage();
    await p.goto('/devices');
    await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
    await ctx.close();
  }
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 760 } });
  const page = await ctx.newPage();
  await page.goto(APP);
  const keys = await VirtualKeys.attach(page);
  await keys.add({ prf: false });
  await keys.use(0);
  await page.getByRole('button', { name: 'Create a new vault' }).click();
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('button', { name: 'Set up key 1' }).click();
  await expect(page.getByRole('link', { name: 'See supported devices' })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/app-key-error-devices-link.png` });
  await ctx.close();
});

test('donation (add-donation): coffee pill at rest and on hover, /support desktop and phone, app footer link', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('/');
  const band = page.locator('.footer-support');
  await band.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await band.screenshot({ path: `${dir}/coffee-pill.png` });
  await page.locator('a.coffee').hover();
  await page.waitForTimeout(450); // steam mid-rise, sheen mid-sweep
  await band.screenshot({ path: `${dir}/coffee-pill-hover.png` });
  await page.goto('/support');
  await page.screenshot({ path: `${dir}/support.png`, fullPage: true });
  await ctx.close();
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await phone.newPage();
  await p.goto('/support');
  await p.screenshot({ path: `${dir}/support-phone.png`, fullPage: true });
  await p.goto('/app/');
  await p.getByRole('contentinfo').scrollIntoViewIfNeeded();
  await p.getByRole('contentinfo').screenshot({ path: `${dir}/app-footer-coffee.png` });
  await phone.close();
});

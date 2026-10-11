/**
 * reload-on-new-build 5.1: a tab running an older build than the site serves never writes. The served /app/ page is
 * swapped for one naming a different entry script (what a deploy does); Save is refused before any key tap with
 * "CryoShield was updated" and Reload page, the edit stays, and after the reload a save works again.
 */
import { expect, test, type Page } from '@playwright/test';
import { APP } from '../fixtures/routes';
import { ArweaveStub } from '../fixtures/arweave';
import { VirtualKeys } from '../fixtures/webauthn';
import { createVault, unlockWith } from '../fixtures/app';

const OUTDATED = 'Nothing was saved. CryoShield was updated since you opened this page.';

/**
 * Serves /app/ with every module entry renamed, as after a deploy (only fetches made after this call). Returns the undo,
 * which serves the real page again (the "new build" a reload then runs).
 */
async function deployNewBuild(page: Page): Promise<() => Promise<void>> {
  const isApp = (url: URL) => url.pathname === APP;
  // Fetched once up front and served from memory, so the check never waits on a proxied request (its 4 s timeout
  // would otherwise make a slow test machine look like "unknown").
  const served = await page.request.get(APP);
  const html = (await served.text()).replace(/(<script\b[^>]*\bsrc="\/assets\/)([^"]+)"/g, '$1next-$2"');
  expect(html).toContain('src="/assets/next-');
  await page.route(isApp, (route) => route.fulfill({ status: 200, headers: served.headers(), body: html }));
  return () => page.unroute(isApp);
}

test('an outdated tab is refused before any tap; Reload page brings the new build and saving works again', async ({ page }) => {
  const arweave = new ArweaveStub();
  await arweave.install(page);
  await page.goto(APP);
  const keys = await VirtualKeys.attach(page);
  await keys.add();
  await keys.add();
  await createVault(page, keys, [{ label: 'Seed', secret: 'one' }]);
  await unlockWith(page, keys, 0);

  await page.getByRole('button', { name: 'Edit secrets' }).click();
  await page.locator('#secret-0').fill('two');
  const undo = await deployNewBuild(page);
  const taps = await keys.signCount(0);
  const checked = page.waitForRequest((r) => new URL(r.url()).pathname === APP && r.method() === 'GET');
  await page.getByRole('button', { name: 'Save' }).click();
  const req = await checked;
  expect(new URL(req.url()).search).toBe(''); // no query string, nothing about the vault
  expect(req.postData()).toBeNull();

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('CryoShield was updated');
  await expect(alert).toContainText(OUTDATED);
  await expect(page.locator('#secret-0')).toHaveValue('two');
  expect(await keys.signCount(0)).toBe(taps); // no key ceremony

  await undo();
  await alert.getByRole('button', { name: 'Reload page' }).click();
  await expect(page.getByRole('button', { name: 'Unlock my vault' })).toBeVisible({ timeout: 30_000 });

  // After the reload this tab runs the served build: the same edit saves.
  await keys.use(0);
  await page.getByRole('button', { name: 'Unlock my vault' }).click();
  await page.getByRole('button', { name: 'Unlock with my key' }).click();
  await expect(page.getByRole('heading', { name: 'Your vault', exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Edit secrets' }).click();
  await page.locator('#secret-0').fill('two');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible({ timeout: 60_000 });
});

test('returning to an outdated tab shows the "new version" notice with Reload page', async ({ page }) => {
  await page.goto(APP);
  await expect(page.getByRole('button', { name: 'Unlock my vault' })).toBeVisible();
  await deployNewBuild(page);
  // The start-up check ran before the deploy; a tab switch asks again (after the 60 s throttle).
  await page.clock.install();
  await page.clock.fastForward(61_000);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const note = page.getByRole('status').filter({ hasText: 'A new version of CryoShield is available.' });
  await expect(note).toBeVisible();
  await expect(note.getByRole('button', { name: 'Reload page' })).toBeVisible();
});

/** add-privacy-and-compliance 3.4 (spec legal-pages "No third-party requests", "Inventory matches reality"). */
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ArweaveStub } from '../fixtures/arweave';
import { VirtualKeys } from '../fixtures/webauthn';
import { createVault, unlockWith } from '../fixtures/app';
import { APP, LANDING } from '../fixtures/routes';

const inventory = JSON.parse(readFileSync(new URL('../../legal/storage-inventory.json', import.meta.url), 'utf8')) as {
  routes: Record<string, Record<string, string[]>>;
};
const LEGAL = ['/privacy', '/terms', '/cookies'];

/** Everything a page could have stored on the device, in the inventory's shape. */
async function sweep(page: Page) {
  const s = await page.evaluate(async () => ({
    localStorage: Object.keys(localStorage),
    sessionStorage: Object.keys(sessionStorage),
    indexedDB: (await indexedDB.databases()).map((d) => d.name ?? ''),
    cacheStorage: await caches.keys(),
    serviceWorkers: (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope),
    documentCookie: document.cookie,
  }));
  const cookies = (await page.context().cookies()).map((c) => c.name);
  return { cookies: [...new Set([...cookies, ...(s.documentCookie ? s.documentCookie.split(';').map((c) => c.split('=')[0]!.trim()) : [])])], localStorage: s.localStorage, sessionStorage: s.sessionStorage, indexedDB: s.indexedDB, cacheStorage: s.cacheStorage, serviceWorkers: s.serviceWorkers };
}

test('the legal pages make only same-origin requests and pass axe', async ({ page, baseURL }) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  for (const p of LEGAL) {
    await page.goto(p);
    await expect(page.locator('.legal-note')).toBeVisible();
    await expect(page.locator('.draft-banner')).toHaveCount(0);
    await expect(page.locator('main h1')).toBeVisible();
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(r.violations.map((v) => `${p}: ${v.id}`)).toEqual([]);
  }
  for (const u of requests) if (!u.startsWith('data:')) expect(new URL(u).origin, u).toBe(new URL(baseURL!).origin);
});

test('device storage on every route equals the published inventory (create + unlock included)', async ({ page }) => {
  const arweave = new ArweaveStub();
  await arweave.install(page);
  await page.goto(LANDING);
  await page.waitForTimeout(500);
  expect(await sweep(page), '/').toEqual(inventory.routes['/']);

  await page.goto(APP);
  const keys = await VirtualKeys.attach(page);
  await keys.add();
  await keys.add();
  await createVault(page, keys, [{ label: 'Seed', secret: 'storage sweep' }]);
  await unlockWith(page, keys, 1);
  expect(await sweep(page), '/app/').toEqual(inventory.routes['/app/']);

  for (const p of LEGAL) {
    await page.goto(p);
    expect(await sweep(page), p).toEqual(inventory.routes[p]);
  }
});

test('the published /cookies table matches the inventory file', async ({ page }) => {
  await page.goto('/cookies');
  const rows = await page.locator('[data-testid="storage-inventory"] tbody tr').evaluateAll((trs) =>
    trs.map((tr) => [...tr.querySelectorAll('th, td')].map((c) => c.textContent?.trim())),
  );
  for (const route of Object.keys(inventory.routes)) {
    const row = rows.find((r) => r[0] === route)!;
    expect(row, route).toBeDefined();
    expect(row.slice(1), route).toEqual(['None', 'None', 'None', 'None', 'None', 'None']);
  }
});

test('no bundler, paymaster or Arweave request before the permanence + 18+ acknowledgement (4.1)', async ({ page }) => {
  const arweave = new ArweaveStub();
  await arweave.install(page);
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
  const writes: string[] = [];
  page.on('request', (r) => {
    if (/127\.0\.0\.1:4337|upload\.ardrive\.io/.test(r.url())) writes.push(r.url());
  });
  await page.locator('#label-0').fill('Seed');
  await page.locator('#secret-0').fill('not yet');
  const save = page.getByRole('button', { name: 'Save' });
  await expect(save).toBeDisabled();
  await page.locator('#secret-0').press('Enter');
  await page.getByRole('checkbox', { name: /published permanently/ }).check();
  await expect(save).toBeDisabled();
  await expect(page.getByText('CryoShield is only for people aged 18 or over.', { exact: false })).toBeVisible();
  await page.waitForTimeout(500);
  expect(writes).toEqual([]);
  await page.getByRole('checkbox', { name: 'I am 18 or over.' }).check();
  await keys.use(0);
  await save.click();
  await expect(page.getByRole('heading', { name: 'Your vault is saved' })).toBeVisible({ timeout: 60_000 });
  expect(writes.length).toBeGreaterThan(0);
});

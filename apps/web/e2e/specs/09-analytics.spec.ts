/**
 * add-privacy-preserving-analytics 4.5 / 4.6 (spec landing-analytics). Runs against the `e2e-analytics` build (port
 * 4174), which ships the beacon template with a dummy token. Cloudflare's endpoints are routed: the beacon URL serves
 * e2e/fixtures/cf-beacon.stub.js (pinned by e2e/fixtures/beacon.lock.e2e.json) and the report endpoint is captured.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { ArweaveStub } from '../fixtures/arweave';
import { VirtualKeys } from '../fixtures/webauthn';
import { createVault, unlockWith } from '../fixtures/app';
import { APP, LANDING } from '../fixtures/routes';

const STUB = readFileSync(new URL('../fixtures/cf-beacon.stub.js', import.meta.url));
const BEACON = 'https://static.cloudflareinsights.com/beacon.min.js';
const isCf = (u: string) => /^https:\/\/(static\.)?cloudflareinsights\.com\//.test(u);

interface Cf {
  requests: { url: string; body: string; at: number }[];
  setCookies: number;
}
async function routeCloudflare(page: Page, beaconBytes: Buffer = STUB): Promise<Cf> {
  const cf: Cf = { requests: [], setCookies: 0 };
  page.on('request', (r) => {
    if (isCf(r.url())) cf.requests.push({ url: r.url(), body: r.postData() ?? '', at: Date.now() });
  });
  page.on('response', async (r) => {
    if (isCf(r.url()) && (await r.headerValue('set-cookie'))) cf.setCookies++;
  });
  await page.route(BEACON, (route) => route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: beaconBytes }));
  await page.route('https://cloudflareinsights.com/**', (route) => route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }));
  return cf;
}
const rumBodies = (cf: Cf) => cf.requests.filter((r) => r.url.includes('/cdn-cgi/rum')).map((r) => r.body);
function watchConsole(page: Page) {
  const bad: string[] = [];
  page.on('console', (m) => {
    if (/Trusted Type|Content Security Policy/i.test(m.text())) bad.push(m.text());
  });
  page.on('pageerror', (e) => bad.push(String(e)));
  return bad;
}

test('the beacon loads once with integrity, reports without query/fragment, and leaves nothing on the device', async ({ page }) => {
  const cf = await routeCloudflare(page);
  const bad = watchConsole(page);
  await page.goto(`${LANDING}?ref=abc&utm_source=x#frag`);
  await expect.poll(() => rumBodies(cf).length).toBe(1);
  const s = page.locator('head script[data-cf-beacon]');
  await expect(s).toHaveCount(1);
  expect(await s.getAttribute('integrity')).toMatch(/^sha384-/);
  expect(await s.getAttribute('crossorigin')).toBe('anonymous');
  expect(JSON.parse((await s.getAttribute('data-cf-beacon'))!)).toMatchObject({ spa: false });
  expect(page.url()).not.toMatch(/abc|utm_source|frag/);
  for (const r of cf.requests) {
    for (const needle of ['abc', 'utm_source', 'frag']) {
      expect(r.url, needle).not.toContain(needle);
      expect(r.body, needle).not.toContain(needle);
    }
  }
  const storage = await page.evaluate(() => ({ cookie: document.cookie, local: localStorage.length, session: sessionStorage.length }));
  expect(storage).toEqual({ cookie: '', local: 0, session: 0 });
  expect(await page.context().cookies()).toEqual([]);
  expect(cf.setCookies).toBe(0);
  expect(bad).toEqual([]);
});

for (const [name, script] of [
  ['GPC', () => Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true })],
  ['DNT', () => Object.defineProperty(Navigator.prototype, 'doNotTrack', { get: () => '1' })],
] as const) {
  test(`${name} suppresses the beacon entirely`, async ({ page }) => {
    await page.addInitScript(script);
    const cf = await routeCloudflare(page);
    await page.goto(LANDING);
    await page.waitForTimeout(1000);
    await expect(page.locator('script[data-cf-beacon]:not(template script)')).toHaveCount(0);
    expect(cf.requests).toEqual([]);
  });
}

test('a hash-mismatched beacon is refused and the page works normally', async ({ page }) => {
  const cf = await routeCloudflare(page, Buffer.concat([STUB, Buffer.from('\n// tampered\n')]));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(LANDING);
  await page.waitForTimeout(1000);
  expect(rumBodies(cf)).toEqual([]);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.locator('#how').scrollIntoViewIfNeeded();
  await expect(page.locator('#how .scene-stage.live')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('blocked analytics endpoints leave the landing page working, and its link to /app/ works', async ({ page }) => {
  await page.route(/cloudflareinsights\.com/, (r) => r.abort('blockedbyclient'));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(LANDING);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.locator('#stored').scrollIntoViewIfNeeded();
  await expect(page.locator('#stored .scene-stage.live')).toHaveCount(1);
  await page.getByRole('link', { name: 'Open the app' }).first().click();
  await expect(page.getByRole('button', { name: 'Unlock my vault' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('/app/: create, unlock and update make zero Cloudflare requests, including after landing -> app navigation', async ({ page }) => {
  const cf = await routeCloudflare(page);
  const arweave = new ArweaveStub();
  await arweave.install(page);
  await page.goto(LANDING);
  await expect.poll(() => rumBodies(cf).length).toBe(1);
  const navStart = Date.now();
  await page.getByRole('link', { name: 'Open the app' }).first().click();
  await expect(page).toHaveURL(/\/app\/$/);
  const keys = await VirtualKeys.attach(page);
  await keys.add();
  await keys.add();
  await createVault(page, keys, [{ label: 'Seed', secret: 'no analytics here' }]);
  await unlockWith(page, keys, 1);
  await page.getByRole('button', { name: 'Edit secrets' }).click();
  await page.locator('#secret-0').fill('still none');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible({ timeout: 60_000 });
  expect(cf.requests.filter((r) => r.at >= navStart)).toEqual([]);
  expect(await page.locator('script[data-cf-beacon], #cf-beacon').count()).toBe(0);
});

test('a WebAuthn ceremony cannot start on the landing page (Permissions-Policy)', async ({ page }) => {
  await routeCloudflare(page);
  await page.goto(LANDING);
  const r = await page.evaluate(async () => {
    try {
      await navigator.credentials.get({ publicKey: { challenge: new Uint8Array(32), rpId: 'localhost', timeout: 2000 } });
      return 'resolved';
    } catch (e) {
      return `${(e as Error).name}: ${(e as Error).message}`;
    }
  });
  // Rejected by the Permissions-Policy itself (not by a missing authenticator or a timeout).
  expect(r).toMatch(/^NotAllowedError: .*publickey-credentials-get/);
  const allowed = (p: Page) => p.evaluate(() => (document as unknown as { featurePolicy: { allowsFeature(f: string): boolean } }).featurePolicy.allowsFeature('publickey-credentials-get'));
  expect(await allowed(page)).toBe(false);
  await page.goto(APP);
  expect(await allowed(page)).toBe(true);
});

test('the app refuses to run in a window opened by script from the landing page', async ({ page, context }) => {
  await routeCloudflare(page);
  await page.goto(LANDING);
  const calls: string[] = [];
  await context.exposeFunction('__credCall', (n: string) => calls.push(n));
  await context.addInitScript(() => {
    const w = window as unknown as { __credCall: (n: string) => void };
    for (const m of ['get', 'create'] as const) {
      const orig = navigator.credentials[m].bind(navigator.credentials);
      (navigator.credentials as unknown as Record<string, unknown>)[m] = (...a: unknown[]) => {
        w.__credCall(m);
        return (orig as (...x: unknown[]) => unknown)(...a);
      };
    }
  });
  const net: string[] = [];
  context.on('request', (r) => {
    if (/127\.0\.0\.1:(8545|4337)|upload\.ardrive\.io|arweave\.net/.test(r.url())) net.push(r.url());
  });
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.evaluate(() => void window.open('/app/'))]);
  await expect(popup.getByRole('heading', { name: 'Open CryoShield directly' })).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Unlock my vault' })).toHaveCount(0);
  await popup.waitForTimeout(500);
  expect(calls).toEqual([]);
  expect(net).toEqual([]);
});

test('direct navigation to /app/ is not affected by the opener guard', async ({ page }) => {
  await page.goto(APP);
  await expect(page.getByRole('button', { name: 'Unlock my vault' })).toBeVisible();
});

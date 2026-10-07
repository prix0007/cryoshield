/** Task 9.1: network allowlist, empty storage, no PRF output on the wire, CSP blocks injected inline script. */
import { expect, test } from '@playwright/test';
import { APP } from '../fixtures/routes';
import { ArweaveStub } from '../fixtures/arweave';
import { VirtualKeys } from '../fixtures/webauthn';
import { createVault, unlockWith } from '../fixtures/app';

const ALLOWED = ['http://localhost:4173', 'http://127.0.0.1:8545', 'http://127.0.0.1:4337', 'https://upload.ardrive.io', 'https://arweave.net', 'https://turbo-gateway.com'];

test('every flow: only configured origins, nothing stored, PRF outputs never sent, CSP enforced', async ({ page }) => {
  // Test-only instrumentation (never in the app bundle): record every PRF output the page receives.
  const prfs: string[] = [];
  await page.exposeFunction('__recordPrf', (hex: string) => prfs.push(hex));
  await page.addInitScript(() => {
    const w = window as unknown as { __recordPrf: (h: string) => void };
    const orig = PublicKeyCredential.prototype.getClientExtensionResults;
    PublicKeyCredential.prototype.getClientExtensionResults = function () {
      const r = orig.call(this) as { prf?: { results?: { first?: ArrayBuffer } } };
      const f = r.prf?.results?.first;
      if (f) w.__recordPrf(Array.from(new Uint8Array(f)).map((b) => b.toString(16).padStart(2, '0')).join(''));
      return r as AuthenticationExtensionsClientOutputs;
    };
  });
  const requests: { url: string; body: string }[] = [];
  page.on('request', (r) => requests.push({ url: r.url(), body: r.postDataBuffer()?.toString('hex') ?? '' }));
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Content-Security-Policy|Trusted Type/i.test(m.text())) violations.push(m.text());
  });

  const arweave = new ArweaveStub();
  await arweave.install(page);
  await page.goto(APP);
  const keys = await VirtualKeys.attach(page);
  await keys.add();
  await keys.add();
  // harden-gas-sponsorship 5.5: the write stack is a lazy chunk, not fetched until the first save.
  const stackChunk = /^http:\/\/localhost:4173\/assets\/stack-[\w-]+\.js$/;
  const stackResponses: number[] = [];
  page.on('response', (r) => {
    if (stackChunk.test(r.url())) stackResponses.push(r.status());
  });
  expect(requests.filter((r) => stackChunk.test(r.url))).toEqual([]);
  await createVault(page, keys, [{ label: 'Seed', secret: 'correct horse battery staple' }]);
  await expect(page.getByText('Backup copy saved.')).toBeVisible({ timeout: 15_000 });
  expect(stackResponses).toEqual([200]); // fetched by the create's save
  await unlockWith(page, keys, 1); // a fresh page load
  expect(stackResponses).toEqual([200]); // unlocking never fetches the write stack
  await page.getByRole('button', { name: 'Edit secrets' }).click();
  await page.locator('#secret-0').fill('correct horse battery staple 2');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible({ timeout: 60_000 });
  // The real chunk loaded once per page (create, then the edit after the reload), same-origin, under the real CSP, and
  // nothing was blocked before the injection test below.
  expect(stackResponses).toEqual([200, 200]);
  expect(violations).toEqual([]);

  // 1. Network allowlist.
  for (const r of requests) {
    if (r.url.startsWith('data:') || r.url.startsWith('blob:')) continue;
    expect(ALLOWED.some((o) => r.url.startsWith(o)), r.url).toBe(true);
  }

  // 2. Storage stays empty.
  const storage = await page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    cookies: document.cookie,
    idb: (await indexedDB.databases()).length,
    caches: (await caches.keys()).length,
  }));
  expect(storage).toEqual({ local: 0, session: 0, cookies: '', idb: 0, caches: 0 });

  // 3. No PRF output (hex) appears in any request body.
  expect(prfs.length).toBeGreaterThanOrEqual(5); // 2 enrolment + create-sign + unlock + edit + edit-sign
  for (const p of prfs) for (const r of requests) expect(r.body.includes(p), `PRF leaked to ${r.url}`).toBe(false);
  // ...and no plaintext secret either.
  const secretHex = Buffer.from('correct horse battery staple').toString('hex');
  for (const r of requests) expect(r.body.includes(secretHex), `plaintext leaked to ${r.url}`).toBe(false);

  // 4. CSP: an injected inline script does not run; the app keeps working.
  const ran = await page.evaluate(async () => {
    const seen: string[] = [];
    document.addEventListener('securitypolicyviolation', (e) => seen.push(e.violatedDirective));
    const s = document.createElement('script');
    try {
      s.textContent = 'window.__pwned = true';
    } catch {
      seen.push('trusted-types:script-text');
    }
    document.body.appendChild(s);
    try {
      const inline = document.createElement('div');
      inline.setAttribute('onclick', 'window.__pwned = true');
      document.body.appendChild(inline);
      inline.click();
    } catch {
      seen.push('trusted-types:event-handler');
    }
    try {
      document.body.insertAdjacentHTML('beforeend', '<img src=x onerror="window.__pwned=true">');
    } catch {
      seen.push('trusted-types:html');
    }
    await new Promise((r) => setTimeout(r, 100));
    return { pwned: (window as unknown as { __pwned?: boolean }).__pwned === true, seen };
  });
  expect(ran.pwned).toBe(false);
  expect(ran.seen.length + violations.length).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Lock' })).toBeVisible();
});

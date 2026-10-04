/**
 * enforce-credprotect-uv (audit AA-H1), in a real browser with virtual keys.
 * - The app asks for credProtect level 3 with enforcement on every key it enrolls.
 * - A key that cannot confirm level 3 is refused and no vault can be created with it. Chrome's virtual
 *   authenticator has no credProtect, which makes it exactly such a key (see fixtures/webauthn.ts).
 */
import { expect, test } from '@playwright/test';
import { APP } from '../fixtures/routes';
import { VirtualKeys } from '../fixtures/webauthn';

const requests = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __credProtectRequests: { policy?: string; enforce?: boolean }[] }).__credProtectRequests);

test('a key without credProtect level 3 is refused at enrollment; nothing is enrolled', async ({ page }) => {
  await page.goto(APP);
  const keys = await VirtualKeys.attach(page, { credProtect: false });
  await keys.add();
  await keys.use(0);
  await page.getByRole('button', { name: 'Create a new vault' }).click();
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('button', { name: 'Set up key 1' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Key not supported', { timeout: 15_000 });
  await expect(alert).toContainText('always ask for its PIN');
  await expect(page.getByText('Key 1 is ready.')).toHaveCount(0);
  expect(await keys.credentials(0)).toHaveLength(0); // the browser refused: no credential was created on the key
  expect(await requests(page)).toEqual([{ policy: 'userVerificationRequired', enforce: true }]);
});

test('every enrollment asks for credProtect level 3 with enforcement, and a confirming key is accepted', async ({ page }) => {
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
  const r = await requests(page);
  expect(r.length).toBeGreaterThanOrEqual(2);
  for (const x of r) expect(x).toEqual({ policy: 'userVerificationRequired', enforce: true });
});

/** Failure paths: sponsorship refused (6.7), mirror failure + retry (7.4), self-heal (7.5), no vault (8.2),
 *  key without PRF (3.2), vault details download (8.6). */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { APP } from '../fixtures/routes';
import { ArweaveStub } from '../fixtures/arweave';
import { VirtualKeys } from '../fixtures/webauthn';
import { createVault, rpc, unlockWith } from '../fixtures/app';

test('paymaster refusal shows "Saving is paused" and keeps the edits', async ({ page }) => {
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
  await rpc('cryoshield_setPolicy', [{ refuseAll: true }]);
  try {
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saving is paused right now', { exact: false })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#secret-0')).toHaveValue('two');
  } finally {
    await rpc('cryoshield_setPolicy', [{ refuseAll: false }]);
  }
});

test('a refusal on the FIRST create says nothing was saved and shows a Details reference (improve-write-failure-feedback 1.2)', async ({ page }) => {
  const arweave = new ArweaveStub();
  await arweave.install(page);
  await page.goto(APP);
  const keys = await VirtualKeys.attach(page);
  await keys.add();
  await keys.add();
  await rpc('cryoshield_setPolicy', [{ refuseAll: true }]);
  try {
    await createVault(page, keys, [{ label: 'Seed', secret: 'one' }], { expectSaved: false });
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Nothing was saved. Please try again later.', { timeout: 30_000 });
    await expect(alert).not.toContainText('existing vault');
    const toggle = alert.getByRole('button', { name: 'Details' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(alert.locator('.notice-details code')).toContainText('SPONSORSHIP_REFUSED');
    await expect(alert.locator('.notice-details code')).not.toContainText('http');
  } finally {
    await rpc('cryoshield_setPolicy', [{ refuseAll: false }]);
  }
});

test('mirror failure is non-blocking with Retry; the next unlock self-heals; downloads the exact blob', async ({ page }) => {
  const arweave = new ArweaveStub();
  arweave.failUploads = true;
  await arweave.install(page);
  await page.goto(APP);
  const keys = await VirtualKeys.attach(page);
  await keys.add();
  await keys.add();
  await createVault(page, keys, [{ label: 'Seed', secret: 'one' }]);
  await expect(page.getByText('Your vault is saved')).toBeVisible();
  await expect(page.getByText('Extra backup copy not saved yet.')).toBeVisible({ timeout: 15_000 });
  // fix-arweave-mirror-status: a sanitized reason under Details.
  await page.getByRole('button', { name: 'Details' }).click();
  await expect(page.locator('.notice-details code')).toHaveText('UPLOAD_FAILED · HTTP 503 · upload');
  arweave.failUploads = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('Backup copy saved.')).toBeVisible({ timeout: 15_000 });
  expect(arweave.items).toHaveLength(1);

  // Lose the mirror, unlock: the app re-uploads with no extra tap.
  arweave.items = [];
  const taps = await keys.signCount(1);
  await unlockWith(page, keys, 1);
  await expect.poll(() => arweave.items.length, { timeout: 15_000 }).toBe(1);
  expect((await keys.signCount(1)) - taps).toBe(1);
  // A spoofed item under the same locator does not matter: unlock still uses the on-chain blob.
  const loc = arweave.items[0]!.tags.find((t) => t.name === 'CryoShield-Locator')!.value;
  arweave.items.push({ id: 'junk', tags: [{ name: 'App-Name', value: 'CryoShield' }, { name: 'CryoShield-Locator', value: loc }], data: Buffer.from('junk') });
  await unlockWith(page, keys, 0);
  await expect(page.getByRole('heading', { name: 'Seed' })).toBeVisible();

  // Details & backup file: download is byte-identical to the mirrored (on-chain) blob.
  await page.getByRole('button', { name: 'Details & backup file' }).click();
  const vaultId = (await page.getByTestId('vault-id').textContent())!;
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download encrypted backup file' }).click()]);
  expect(download.suggestedFilename()).toBe(`cryoshield-${vaultId.slice(2, 10)}.cryo`);
  const bytes = readFileSync((await download.path())!);
  expect(bytes.equals(arweave.items.find((i) => i.id !== 'junk')!.data)).toBe(true);
});

test('an unknown key finds no vault and is offered "Create a vault"', async ({ page }) => {
  await page.goto(APP);
  const keys = await VirtualKeys.attach(page);
  await keys.add();
  await keys.use(0);
  // A credential for this RP that was never used for a vault.
  await page.evaluate(async () => {
    await navigator.credentials.create({
      publicKey: {
        rp: { id: 'localhost', name: 'x' },
        user: { id: new Uint8Array(16), name: 'u', displayName: 'u' },
        challenge: new Uint8Array(32),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
      },
    });
  });
  await page.getByRole('button', { name: 'Unlock my vault' }).click();
  await page.getByRole('button', { name: 'Unlock with my key' }).click();
  await expect(page.getByText('We couldn’t find a vault for this key.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Create a vault' })).toBeVisible();
});

test('a key without PRF is refused with a plain message', async ({ page }) => {
  await page.goto(APP);
  const keys = await VirtualKeys.attach(page);
  await keys.add({ prf: false });
  await keys.use(0);
  await page.getByRole('button', { name: 'Create a new vault' }).click();
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('button', { name: 'Set up key 1' }).click();
  await expect(page.getByText('This key is too old', { exact: false })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Key 1 is ready.')).toHaveCount(0);
});

test('a fresh upload is found on Turbo\'s fast index before arweave.net settles: no duplicate on unlock, item link shown', async ({ page }) => {
  const arweave = new ArweaveStub(); // settled = false: arweave.net lists nothing yet
  await arweave.install(page);
  await page.goto(APP);
  const keys = await VirtualKeys.attach(page);
  await keys.add();
  await keys.add();
  await createVault(page, keys, [{ label: 'Seed', secret: 'fast index' }]);
  await expect(page.getByText('Backup copy saved.')).toBeVisible({ timeout: 15_000 });
  const link = page.locator('.mirror-saved a');
  await expect(link).toHaveAttribute('href', `https://turbo-gateway.com/${arweave.items[0]!.id}`);
  await expect(page.getByText('permanent arweave.net link works once it settles', { exact: false })).toBeVisible();
  expect(arweave.items).toHaveLength(1);
  await unlockWith(page, keys, 1);
  await page.waitForTimeout(1500);
  expect(arweave.items).toHaveLength(1); // before the fix, every unlock re-uploaded a duplicate
  await expect(page.getByText('Extra backup copy not saved yet.')).toHaveCount(0);
});

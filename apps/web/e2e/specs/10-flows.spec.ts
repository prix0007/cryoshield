/** Tasks 5.3, 6.3-6.5, 7.4, 8.x: the real app, real contracts, virtual hardware keys. */
import { expect, test } from '@playwright/test';
import { ArweaveStub } from '../fixtures/arweave';
import { VirtualKeys } from '../fixtures/webauthn';
import { createVault, unlockWith } from '../fixtures/app';

test('create with two keys, unlock with either, edit, add a third key; every version is mirrored', async ({ page }) => {
  const arweave = new ArweaveStub();
  await arweave.install(page);
  await page.goto('/');
  const keys = await VirtualKeys.attach(page);
  await keys.add();
  await keys.add();

  await createVault(page, keys, [
    { label: 'Bitcoin seed', secret: 'abandon abandon art' },
    { label: 'GitHub recovery codes', secret: 'aaaa-bbbb\ncccc-dddd' },
  ]);
  await expect(page.getByText('Keep your keys in separate places', { exact: false })).toBeVisible();
  await expect(page.getByText('Backup copy saved.')).toBeVisible({ timeout: 15_000 });
  expect(arweave.items).toHaveLength(1);
  const created = arweave.items[0]!;
  expect(created.tags.filter((t) => t.name === 'CryoShield-Locator')).toHaveLength(2);
  expect(created.tags.find((t) => t.name === 'CryoShield-Version')!.value).toBe('1');

  // Unlock with key 2 only: exactly one assertion for the unlock.
  const before = await keys.signCount(1);
  await unlockWith(page, keys, 1);
  expect((await keys.signCount(1)) - before).toBe(1);
  await expect(page.getByRole('heading', { name: 'Bitcoin seed' })).toBeVisible();
  await expect(page.getByText('abandon abandon art')).toHaveCount(0); // hidden until Show
  await page.getByRole('button', { name: 'Show Bitcoin seed' }).click();
  await expect(page.getByText('abandon abandon art')).toBeVisible();

  // Edit with key 2 (one key), then unlock with key 1 and see it.
  await page.getByRole('button', { name: 'Edit secrets' }).click();
  await page.getByRole('button', { name: 'Add another secret' }).click();
  await page.locator('#label-2').fill('Email 2FA');
  await page.locator('#secret-2').fill('JBSWY3DPEHPK3PXP');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Backup copy saved.')).toBeVisible({ timeout: 15_000 });

  await unlockWith(page, keys, 0);
  await expect(page.getByRole('heading', { name: 'Email 2FA' })).toBeVisible();

  // Add key 3 using key 1 only.
  const k3 = await keys.add();
  await page.getByRole('button', { name: 'Add a key' }).click();
  await page.getByRole('button', { name: 'Add a key' }).click();
  // key 1 is active: it answers the "current key" tap. Then swap keys at each Continue.
  await expect(page.getByText('Now insert your new key', { exact: false })).toBeVisible({ timeout: 15_000 });
  await keys.use(k3);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Put your current key back', { exact: false })).toBeVisible({ timeout: 15_000 });
  await keys.use(0);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Your new key is ready', { exact: false })).toBeVisible({ timeout: 60_000 });

  await unlockWith(page, keys, k3);
  await expect(page.getByRole('heading', { name: 'Email 2FA' })).toBeVisible();

  // Mirror: versions 1..3 uploaded; v3 carries 3 locators; any locator finds it.
  const versions = arweave.items.map((i) => i.tags.find((t) => t.name === 'CryoShield-Version')!.value);
  expect(versions).toEqual(expect.arrayContaining(['1', '2', '3']));
  const v3 = arweave.items.find((i) => i.tags.some((t) => t.name === 'CryoShield-Version' && t.value === '3'))!;
  expect(v3.tags.filter((t) => t.name === 'CryoShield-Locator')).toHaveLength(3);
});

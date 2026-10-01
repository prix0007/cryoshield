import { expect, type Page } from '@playwright/test';
import type { VirtualKeys } from './webauthn';

export async function rpc(method: string, params: unknown[] = [], url = 'http://127.0.0.1:4337') {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = (await r.json()) as { result?: unknown; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

/** Full create flow with keys 0 and 1 and the given secrets. Returns when the "saved" screen shows. */
export async function createVault(page: Page, keys: VirtualKeys, items: { label: string; secret: string }[]) {
  await page.getByRole('button', { name: 'Create a new vault' }).click();
  await page.getByRole('button', { name: 'Get started' }).click();
  await keys.use(0);
  await page.getByRole('button', { name: 'Set up key 1' }).click();
  await expect(page.getByText('Key 1 is ready.')).toBeVisible();
  await keys.use(1);
  await page.getByRole('button', { name: 'Set up key 2' }).click();
  await expect(page.getByText('Key 2 is ready.')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  for (let i = 0; i < items.length; i++) {
    if (i > 0) await page.getByRole('button', { name: 'Add another secret' }).click();
    await page.locator(`#label-${i}`).fill(items[i]!.label);
    await page.locator(`#secret-${i}`).fill(items[i]!.secret);
  }
  await keys.use(0); // key 1 signs
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Your vault is saved' })).toBeVisible({ timeout: 60_000 });
}

export async function unlockWith(page: Page, keys: VirtualKeys, i: number) {
  await page.goto('/');
  await keys.use(i);
  await page.getByRole('button', { name: 'Unlock my vault' }).click();
  await page.getByRole('button', { name: 'Unlock with my key' }).click();
  await expect(page.getByRole('heading', { name: 'Your vault', exact: true })).toBeVisible({ timeout: 30_000 });
}

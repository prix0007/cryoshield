/** Task 8.8: axe-core (WCAG 2.2 A/AA) on every screen, keyboard-only create + unlock, 24px+ targets. */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ArweaveStub } from '../fixtures/arweave';
import { VirtualKeys } from '../fixtures/webauthn';

async function audit(page: Page, screen: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${screen}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('button, input, textarea, a[href]')]
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width < 24 || r.height < 24).length,
  );
  expect(small, `${screen}: targets smaller than 24x24`).toBe(0);
}

test('keyboard-only create and unlock; every screen passes axe', async ({ page }) => {
  const arweave = new ArweaveStub();
  await arweave.install(page);
  await page.goto('/');
  const keys = await VirtualKeys.attach(page);
  await keys.add();
  await keys.add();
  await audit(page, 'home');

  const press = async (name: string) => {
    // Tab until the named button has focus, then press Enter (keyboard only).
    for (let i = 0; i < 30; i++) {
      const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
      if (focused === name) return page.keyboard.press('Enter');
      await page.keyboard.press('Tab');
    }
    throw new Error(`could not reach "${name}" with Tab`);
  };

  await press('Create a new vault');
  await expect(page.getByRole('heading', { name: 'How it works' })).toBeFocused();
  await audit(page, 'create/intro');
  await press('Get started');
  await expect(page.getByRole('heading', { name: 'Set up your keys' })).toBeFocused();
  await audit(page, 'create/keys');
  await keys.use(0);
  await press('Set up key 1');
  await expect(page.getByText('Key 1 is ready.')).toBeVisible();
  await keys.use(1);
  await press('Set up key 2');
  await expect(page.getByText('Key 2 is ready.')).toBeVisible();
  await press('Continue');
  await expect(page.getByRole('heading', { name: 'Add your secrets' })).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.type('Seed');
  await page.keyboard.press('Tab');
  await page.keyboard.type('abandon art');
  await audit(page, 'create/secrets');
  await keys.use(0);
  await press('Save');
  await expect(page.getByRole('heading', { name: 'Your vault is saved' })).toBeFocused({ timeout: 60_000 });
  await audit(page, 'create/done');
  await press('Continue');
  await audit(page, 'vault');
  await press('Vault details');
  await audit(page, 'details');
  await press('Close');
  await press('Lock');
  await expect(page.getByText('Your vault is locked.')).toBeVisible();

  await keys.use(1);
  await press('Unlock my vault');
  await audit(page, 'unlock');
  await press('Unlock with my key');
  await expect(page.getByRole('heading', { name: 'Seed' })).toBeVisible({ timeout: 30_000 });
  await press('Edit secrets');
  await audit(page, 'edit');
  await press('Cancel');
  await press('Add a key');
  await audit(page, 'add-key');
});

/** Task 8.8 + redesign-landing-and-app-ui 4.4: axe-core (WCAG 2.2 A/AA) on every screen, keyboard-only create +
 *  unlock, 44x44 targets for buttons, inputs and standalone links, and focus never hidden by the sticky action bar. */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { APP } from '../fixtures/routes';
import { ArweaveStub } from '../fixtures/arweave';
import { VirtualKeys } from '../fixtures/webauthn';

async function audit(page: Page, screen: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${screen}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('button, input, textarea, summary, a[href]')]
      .filter((el) => (el as HTMLElement).offsetParent !== null && !el.closest('p') && !el.classList.contains('skip-link'))
      .map((el) => {
        // A checkbox wrapped in its <label> is activated by the whole label: that is its target.
        const label = (el as HTMLInputElement).type === 'checkbox' ? el.closest('label') : null;
        return { el: el.outerHTML.slice(0, 80), r: (label ?? el).getBoundingClientRect() };
      })
      .filter(({ r }) => r.width < 44 || r.height < 44)
      .map(({ el }) => el),
  );
  expect(small, `${screen}: targets smaller than 44x44`).toEqual([]);
}

test('keyboard-only create and unlock; every screen passes axe', async ({ page }) => {
  const arweave = new ArweaveStub();
  await arweave.install(page);
  await page.goto(APP);
  const keys = await VirtualKeys.attach(page);
  await keys.add();
  await keys.add();
  await audit(page, 'home');

  const press = async (name: string) => {
    // Tab until the named button has focus, then press Enter (keyboard only).
    for (let i = 0; i < 60; i++) {
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
  // Keyboard-only acknowledgement: Tab to each checkbox and press Space.
  for (const label of ['published permanently', 'I am 18 or over.']) {
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      const hit = await page.evaluate((l) => {
        const el = document.activeElement as HTMLInputElement | null;
        return el?.type === 'checkbox' && !!el.closest('label')?.textContent?.includes(l);
      }, label);
      if (hit) break;
    }
    await page.keyboard.press('Space');
  }
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

test('the floating action bar never hides the focused field (WCAG 2.4.11), on a short phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
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
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Add another secret' }).click();
  await page.locator('#label-0').focus();
  for (let i = 0; i < 16; i++) {
    const hidden = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      const bar = document.querySelector('.action-bar');
      if (!el || el === document.body || !bar || bar.contains(el) || el.closest('.site-header') || el.classList.contains('skip-link')) return null;
      const r = el.getBoundingClientRect();
      const b = bar.getBoundingClientRect();
      const header = document.querySelector('.site-header')!.getBoundingClientRect();
      return (r.bottom > b.top + 1 && r.top < b.bottom - 1) || r.top < header.bottom - 1 ? `${el.id || el.textContent} [${r.top},${r.bottom}] bar ${b.top}` : null;
    });
    expect(hidden).toBeNull();
    await page.keyboard.press('Tab');
  }
  await audit(page, 'create/secrets (phone)');
});

test('dark theme: home and an error state pass axe (contrast included)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(APP);
  const keys = await VirtualKeys.attach(page);
  await keys.add({ prf: false });
  await keys.use(0);
  await audit(page, 'dark/home');
  await page.getByRole('button', { name: 'Create a new vault' }).click();
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('button', { name: 'Set up key 1' }).click();
  await expect(page.getByRole('alert')).toContainText('Key not supported');
  await audit(page, 'dark/error');
});

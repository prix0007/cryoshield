/**
 * vault-list-labels-archive 3.5 and 4.1: the real app, real contracts, virtual keys.
 * - a named vault at create (one write), month-only credential labels;
 * - "All vaults" and "Check another key" merging a second key's vault;
 * - the Edit vault sheet, keyboard only: rename + archive in one update;
 * - an archived-only key shows the list with its note (D13);
 * - Archive and clear keeps the blob length;
 * - axe on every new screen; names and labels never reach the console, title, URL, storage or any request.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { APP } from '../fixtures/routes';
import { ArweaveStub } from '../fixtures/arweave';
import { VirtualKeys } from '../fixtures/webauthn';
import { settled } from '../fixtures/motion';

const NAME = 'Family NAMEMARK';
const RENAMED = 'Old family NAMEMARK';
const LABEL = 'Seed LABELMARK';

async function audit(page: Page, screen: string) {
  await settled(page);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${screen}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('button, input, textarea, a[href]')]
      .filter((el) => (el as HTMLElement).offsetParent !== null && !el.closest('p') && !el.classList.contains('skip-link'))
      .map((el) => {
        const label = (el as HTMLInputElement).type === 'checkbox' ? el.closest('label') : null;
        return { el: el.outerHTML.slice(0, 80), r: (label ?? el).getBoundingClientRect() };
      })
      .filter(({ r }) => r.width < 44 || r.height < 44)
      .map(({ el }) => el),
  );
  expect(small, `${screen}: targets smaller than 44x44`).toEqual([]);
}

/** Tab until the element whose text is `name` has focus, then press Enter (keyboard only). */
async function press(page: Page, name: string) {
  await settled(page);
  for (let i = 0; i < 80; i++) {
    const focused = await page.evaluate(() => document.activeElement?.textContent?.replace(/\s+/g, ' ').trim() ?? '');
    if (focused === name) return page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
  }
  throw new Error(`could not reach "${name}" with Tab`);
}

async function create(page: Page, keys: VirtualKeys, pair: [number, number], name: string | undefined, items: { label: string; secret: string }[]) {
  await page.goto(APP);
  await page.getByRole('button', { name: 'Create a new vault' }).click();
  await page.getByRole('button', { name: 'Get started' }).click();
  await keys.use(pair[0]);
  await page.getByRole('button', { name: 'Set up key 1' }).click();
  await expect(page.getByText('Key 1 is ready.')).toBeVisible();
  await keys.use(pair[1]);
  await page.getByRole('button', { name: 'Set up key 2' }).click();
  await expect(page.getByText('Key 2 is ready.')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  if (name) await page.getByLabel('Vault name (optional)').fill(name);
  for (let i = 0; i < items.length; i++) {
    if (i > 0) await page.getByRole('button', { name: 'Add another secret' }).click();
    await page.locator(`#label-${i}`).fill(items[i]!.label);
    await page.locator(`#secret-${i}`).fill(items[i]!.secret);
  }
  await page.getByRole('checkbox', { name: /published permanently/ }).check();
  await page.getByRole('checkbox', { name: 'I am 18 or over.' }).check();
  await keys.use(pair[0]);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Your vault is saved' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Backup copy saved.')).toBeVisible({ timeout: 15_000 });
}

async function unlock(page: Page, keys: VirtualKeys, i: number) {
  await page.goto(APP);
  await keys.use(i);
  await page.getByRole('button', { name: 'Unlock my vault' }).click();
  await page.getByRole('button', { name: 'Unlock with my key' }).click();
}

const itemsOf = (arweave: ArweaveStub, vaultId: string) =>
  arweave.items
    .filter((i) => i.tags.some((t) => t.name === 'CryoShield-Vault-Id' && t.value === vaultId))
    .map((i) => ({ version: Number(i.tags.find((t) => t.name === 'CryoShield-Version')!.value), size: i.data.length }))
    .sort((a, b) => a.version - b.version);

test('vault list, names, archive and Archive and clear: keyboard, axe, and no name or label leaks', async ({ page }) => {
  test.setTimeout(600_000);
  const arweave = new ArweaveStub();
  await arweave.install(page);
  const consoleLines: string[] = [];
  page.on('console', (m) => consoleLines.push(m.text()));
  const requests: string[] = [];
  page.on('request', (r) => requests.push(`${r.url()} ${r.postData() ?? ''}`));
  await page.goto(APP);
  const keys = await VirtualKeys.attach(page);
  for (let i = 0; i < 4; i++) await keys.add();

  // Vault A (keys 0 and 1), named at creation: one create write; then vault B (keys 2 and 3), unnamed.
  await create(page, keys, [0, 1], NAME, [
    { label: LABEL, secret: 'abandon abandon art' },
    { label: 'GitHub recovery codes', secret: 'x'.repeat(120) },
    { label: 'Email', secret: 'JBSWY3DPEHPK3PXP' },
  ]);
  const vaultA = arweave.items[0]!.tags.find((t) => t.name === 'CryoShield-Vault-Id')!.value;
  expect(itemsOf(arweave, vaultA).map((i) => i.version)).toEqual([1]);
  await create(page, keys, [2, 3], undefined, [{ label: 'Other', secret: 'other secret' }]);
  const vaultB = arweave.items.at(-1)!.tags.find((t) => t.name === 'CryoShield-Vault-Id')!.value;

  // D12: credential labels carry the month only, never the vault name.
  for (const k of [0, 1, 2, 3]) {
    for (const c of await keys.credentials(k)) {
      const userName = (c as { userName?: string }).userName;
      if (userName === undefined) continue; // older CDP builds don't report it
      expect(userName).toMatch(/^CryoShield vault · [A-Z][a-z]{2} \d{4} \(key [12]\)$/);
    }
  }

  // Key 0 opens vault A directly, with its name as the heading.
  await unlock(page, keys, 0);
  await expect(page.getByRole('heading', { name: NAME, level: 1 })).toBeVisible({ timeout: 30_000 });
  await audit(page, 'vault (named)');

  // "All vaults (1)", then "Check another key" with key 2: vault B is merged into the list.
  await press(page, 'All vaults (1)');
  await expect(page.getByRole('heading', { name: 'Your vaults', level: 1 })).toBeFocused();
  await audit(page, 'vaults (menu)');
  await keys.use(2);
  await press(page, 'Check another key');
  await expect(page.getByRole('heading', { name: 'Unnamed vault', level: 3 })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 3 })).toHaveCount(2);
  await expect(page.getByText('Created ', { exact: false }).first()).toBeVisible();
  await audit(page, 'vaults (menu, two keys)');

  // Edit vault, keyboard only: rename and archive in ONE update.
  await press(page, `Edit vault ${NAME}`);
  await expect(page.getByRole('heading', { name: 'Edit vault' })).toBeFocused({ timeout: 15_000 });
  await audit(page, 'edit vault');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Vault name (optional)')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(RENAMED);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('checkbox', { name: 'Archive this vault' })).toBeFocused();
  await page.keyboard.press('Space');
  await keys.use(0);
  await press(page, 'Save');
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('heading', { name: RENAMED, level: 1 })).toBeVisible();
  await expect(page.getByText('This vault is archived.')).toBeVisible();
  await expect(page.getByText('Backup copy saved.')).toBeVisible({ timeout: 15_000 });
  expect(itemsOf(arweave, vaultA).map((i) => i.version)).toEqual([1, 2]); // exactly one update

  // D13: key 0 now opens only an archived vault: the list, expanded, with the note; nothing opens by itself.
  // (Chrome's CDP virtual authenticators refuse a key's first discoverable assertion late in a long session, so the
  // later unlocks use keys that have already answered one: 0 and 2. Real keys have no such limit.)
  await unlock(page, keys, 0);
  await expect(page.getByText('This key’s vault is archived.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('region', { name: 'Archived vaults' }).getByRole('heading', { name: RENAMED })).toBeVisible();
  await audit(page, 'vaults (picker, archived only)');
  await press(page, `Open ${RENAMED}`);
  await expect(page.getByRole('heading', { name: RENAMED, level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: LABEL })).toBeVisible();

  // Archive and clear vault B: the confirmation is required, the blob keeps its length, one update.
  await unlock(page, keys, 2);
  await expect(page.getByRole('heading', { name: 'Your vault', exact: true })).toBeVisible({ timeout: 30_000 });
  await press(page, 'Edit vault');
  await press(page, 'Archive and clear…');
  const clear = page.getByRole('button', { name: 'Archive and clear', exact: true });
  await expect(clear).toBeDisabled();
  await expect(page.getByText('Anyone who holds any of this vault’s keys and its PIN can still read those earlier versions.')).toBeVisible();
  await audit(page, 'archive and clear');
  await page.getByRole('checkbox', { name: 'I understand old versions stay readable' }).check();
  await keys.use(2);
  await clear.click();
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('This vault is archived.')).toBeVisible();
  await expect(page.getByText('Your vault has no secrets yet', { exact: false })).toBeVisible();
  await expect(page.getByText('Backup copy saved.')).toBeVisible({ timeout: 15_000 });
  const b = itemsOf(arweave, vaultB);
  expect(b.map((i) => i.version)).toEqual([1, 2]);
  expect(b[1]!.size).toBe(b[0]!.size);

  // Lock wipes everything; names and labels never left the page's memory.
  await page.getByRole('button', { name: 'Lock' }).click();
  await expect(page.getByText('Your vault is locked.')).toBeVisible();
  const html = await page.content();
  const state = await page.evaluate(async () => ({
    title: document.title,
    url: location.href,
    local: JSON.stringify({ ...localStorage }),
    session: JSON.stringify({ ...sessionStorage }),
    cookies: document.cookie,
    idb: (await indexedDB.databases()).length,
    caches: (await caches.keys()).length,
  }));
  expect(state.idb).toBe(0);
  expect(state.caches).toBe(0);
  for (const marker of ['NAMEMARK', 'LABELMARK']) {
    expect(html).not.toContain(marker);
    expect(consoleLines.join('\n')).not.toContain(marker);
    for (const v of [state.title, state.url, state.local, state.session, state.cookies]) expect(v).not.toContain(marker);
    const hex = Buffer.from(marker).toString('hex');
    for (const r of requests) {
      expect(r.includes(marker), `plaintext name or label sent: ${r.slice(0, 80)}`).toBe(false);
      expect(r.includes(hex), `hex name or label sent: ${r.slice(0, 80)}`).toBe(false);
    }
  }
});

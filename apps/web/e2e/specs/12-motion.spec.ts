/**
 * app-motion-ux 4.2: every transition ends at rest with focus on the new heading; the save checklist ticks in the real
 * write order; reveal/copy/disclosure end states; reduced motion has no transforms; no CSP / Trusted Types console
 * violation or page error anywhere; axe passes with and without reduced motion.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { APP } from '../fixtures/routes';
import { ArweaveStub } from '../fixtures/arweave';
import { VirtualKeys } from '../fixtures/webauthn';
import { unlockWith } from '../fixtures/app';
import { settled } from '../fixtures/motion';

const REST = new Set(['none', 'matrix(1, 0, 0, 1, 0, 0)']);

/** Collects CSP / Trusted Types console messages and page errors for the whole test. */
function watchConsole(page: Page) {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Content-Security-Policy|Trusted Type|TrustedHTML|TrustedScript/i.test(m.text())) problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

/** All animated step containers are at rest: fully opaque, untransformed. */
async function atRest(page: Page) {
  await expect
    .poll(async () =>
      (await page.locator('.step-motion').evaluateAll((els) => els.map((e) => [getComputedStyle(e).opacity, getComputedStyle(e).transform]))).every(
        ([o, t]) => o === '1' && REST.has(t!),
      ),
    )
    .toBe(true);
}

/** Navigates and checks the transition end state: the new step heading is focused and everything is at rest. */
async function step(page: Page, click: string, heading: string) {
  await page.getByRole('button', { name: click, exact: true }).click();
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeFocused();
  await atRest(page);
}

async function axe(page: Page, where: string) {
  await settled(page);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${where}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

/** Records the order in which save-checklist stages become "done" (class stage-done), across step changes. */
async function recordStages(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __stages: string[] };
    w.__stages = [];
    const scan = () => {
      for (const li of document.querySelectorAll('.stage-done')) {
        const label = li.textContent!.replace(/: done$/, '');
        if (!w.__stages.includes(label)) w.__stages.push(label);
      }
    };
    new MutationObserver(scan).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  });
}

test('motion: transitions end at rest, focus follows, the checklist ticks in real order, reveal/copy/disclosure, no CSP errors, axe', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const problems = watchConsole(page);
  const arweave = new ArweaveStub();
  await arweave.install(page);
  await page.goto(APP);
  const keys = await VirtualKeys.attach(page);
  await keys.add();
  await keys.add();

  // Create: intro -> keys (slots fill with a ✓) -> secrets -> saving -> done.
  await step(page, 'Create a new vault', 'How it works');
  await step(page, 'Get started', 'Set up your keys');
  await keys.use(0);
  await page.getByRole('button', { name: 'Set up key 1' }).click();
  const slot = page.locator('.key-ready').filter({ hasText: 'Key 1 is ready.' });
  await expect(slot).toBeVisible();
  await expect.poll(() => slot.evaluate((e) => [getComputedStyle(e).opacity, getComputedStyle(e).transform].join('|'))).toMatch(/^1\|(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
  await keys.use(1);
  await page.getByRole('button', { name: 'Set up key 2' }).click();
  await expect(page.getByText('Key 2 is ready.')).toBeVisible();
  await axe(page, 'keys');
  await step(page, 'Continue', 'Add your secrets');
  await page.locator('#label-0').fill('Seed');
  await page.locator('#secret-0').fill('correct horse battery staple');
  await page.getByRole('checkbox', { name: /published permanently/ }).check();
  await page.getByRole('checkbox', { name: 'I am 18 or over.' }).check();
  await keys.use(0);
  await recordStages(page);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Your vault is saved' })).toBeFocused({ timeout: 60_000 });
  await expect(page.getByText('Backup copy saved.')).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __stages: string[] }).__stages))
    .toEqual(['Encrypted on this device', 'Network fee sponsored', 'Signed and sent', 'Confirmed on-chain', 'Backup copy saved to Arweave']);
  await atRest(page);
  await axe(page, 'done');

  // Unlock -> vault: reveal de-blurs to a sharp, opaque end state only after Show.
  await unlockWith(page, keys, 1);
  await atRest(page);
  await expect(page.getByText('correct horse battery staple')).toHaveCount(0);
  // Sample the reveal frame by frame: it really starts blurred and resolves to sharp.
  await page.evaluate(() => {
    const w = window as unknown as { __filters: string[] };
    w.__filters = [];
    const tick = () => {
      const p = document.querySelector('.secret-value pre');
      if (p) w.__filters.push(getComputedStyle(p).filter);
      if (w.__filters.length < 40) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.getByRole('button', { name: 'Show Seed' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __filters: string[] }).__filters.length)).toBeGreaterThanOrEqual(40);
  expect((await page.evaluate(() => (window as unknown as { __filters: string[] }).__filters)).some((f) => /blur\((?!0px)/.test(f))).toBe(true);
  const pre = page.locator('.secret-value pre');
  await expect(pre).toHaveText('correct horse battery staple');
  await expect.poll(() => pre.evaluate((e) => [getComputedStyle(e).opacity, getComputedStyle(e).filter].join('|'))).toMatch(/^1\|(none|blur\(0px\))$/);

  // Copy: pop chip + a countdown bar that is really shrinking; the text says when the clipboard clears.
  await page.getByRole('button', { name: 'Copy Seed' }).click();
  await expect(page.locator('.copy-chip')).toBeVisible();
  await expect(page.getByText('Clipboard clears in 30 s')).toBeVisible();
  const scaleX = () => page.locator('.copy-bar').evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).a);
  const first = await scaleX();
  await page.waitForTimeout(1_000);
  expect(await scaleX()).toBeLessThan(first);
  await axe(page, 'vault + copy');

  // Vault modes: edit, add key, details (each focuses its heading at rest), and back.
  await step(page, 'Edit secrets', 'Edit secrets');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Seed' })).toBeVisible();
  await atRest(page);
  await step(page, 'Add a key', 'Add a key');
  await page.getByRole('button', { name: 'Back' }).click();
  await atRest(page);
  await step(page, 'Details & backup file', 'Vault details');
  await axe(page, 'details');

  // Lock goes home at once and focuses the home heading.
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Lock' }).click();
  await expect(page.getByText('correct horse battery staple')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'CryoShield', level: 1 })).toBeFocused();

  expect(problems).toEqual([]);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('no transforms or blur at any point; information stays in text; axe passes', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const problems = watchConsole(page);
    const arweave = new ArweaveStub();
    await arweave.install(page);
    await page.goto(APP);
    // Sample every animation frame: any transform or filter on an animated element is a failure.
    await page.evaluate(() => {
      const w = window as unknown as { __moved: string[] };
      w.__moved = [];
      const tick = () => {
        for (const e of document.querySelectorAll('.step-motion, .key-ready, .copy-chip, .copy-bar, .secret-value pre, .notice, .key-pulse')) {
          const cs = getComputedStyle(e);
          if (!['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(cs.transform) || !['none', 'blur(0px)'].includes(cs.filter)) w.__moved.push(`${e.className}: ${cs.transform} ${cs.filter}`);
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const keys = await VirtualKeys.attach(page);
    await keys.add();
    await keys.add();
    await step(page, 'Create a new vault', 'How it works');
    await step(page, 'Get started', 'Set up your keys');
    await keys.use(0);
    await page.getByRole('button', { name: 'Set up key 1' }).click();
    await expect(page.getByText('Key 1 is ready.')).toBeVisible();
    await keys.use(1);
    await page.getByRole('button', { name: 'Set up key 2' }).click();
    await expect(page.getByText('Key 2 is ready.')).toBeVisible();
    await step(page, 'Continue', 'Add your secrets');
    await page.locator('#secret-0').fill('reduced');
    await page.getByRole('checkbox', { name: /published permanently/ }).check();
    await page.getByRole('checkbox', { name: 'I am 18 or over.' }).check();
    await keys.use(0);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: 'Your vault is saved' })).toBeFocused({ timeout: 60_000 });
    await expect(page.getByRole('list', { name: 'Save progress' })).toContainText('Confirmed on-chain');
    await axe(page, 'reduced: done');
    expect(await page.evaluate(() => (window as unknown as { __moved: string[] }).__moved)).toEqual([]);

    // The vault screen sets up its own sampler after the navigation.
    await unlockWith(page, keys, 1);
    await page.evaluate(() => {
      const w = window as unknown as { __moved: string[] };
      w.__moved = [];
      const tick = () => {
        for (const e of document.querySelectorAll('.step-motion, .copy-chip, .copy-bar, .secret-value pre')) {
          const cs = getComputedStyle(e);
          if (!['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(cs.transform) || !['none', 'blur(0px)'].includes(cs.filter)) w.__moved.push(`${e.className}: ${cs.transform} ${cs.filter}`);
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.getByRole('button', { name: /^Show / }).click();
    await expect(page.getByText('reduced')).toBeVisible();
    await page.getByRole('button', { name: /^Copy / }).click();
    await expect(page.getByText('Clipboard clears in 30 s')).toBeVisible();
    await step(page, 'Edit secrets', 'Edit secrets');
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (window as unknown as { __moved: string[] }).__moved)).toEqual([]);
    await axe(page, 'reduced: edit');
    expect(problems).toEqual([]);
  });
});

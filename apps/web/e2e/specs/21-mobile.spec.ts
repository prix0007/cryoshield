/**
 * add-mobile-e2e (spec vault-web-app "Phone viewport support"): every page and every vault screen on a touch phone.
 * Runs only in the `mobile` (Pixel 7, 412 px) and `mobile-small` (360 px) projects. On each page and each settled
 * vault screen, phoneAudit checks: no horizontal page scroll; every visible control passes a trial tap (visible,
 * stable, not covered) inside the viewport; targets >= 24x24 (WCAG 2.2 2.5.8; < 44 is an advisory annotation); no
 * clipped or overflowing text. Then the menu, theme switch, footer, CTAs and the whole vault flow are driven by tap.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { APP, LANDING } from '../fixtures/routes';
import { ArweaveStub } from '../fixtures/arweave';
import { VirtualKeys } from '../fixtures/webauthn';
import { settled } from '../fixtures/motion';

const PAGES = [LANDING, APP, '/privacy', '/terms', '/cookies', '/architecture', '/devices', '/support'];
const CONTROLS = 'a[href], button, input, select, textarea, summary';

test.beforeEach(({ isMobile, hasTouch }) => {
  test.skip(!isMobile || !hasTouch, 'phone projects only (add-mobile-e2e D1)');
});

type Target = { i: number; desc: string; w: number; h: number; cx: number; cy: number; inline: boolean; box: { l: number; t: number; r: number; b: number } };

/** Every visible control, tagged with data-pa so a Locator can find it. A checkbox or radio's target is its label. */
async function targets(page: Page): Promise<Target[]> {
  return page.evaluate((sel) => {
    document.querySelectorAll('[data-pa]').forEach((e) => e.removeAttribute('data-pa'));
    const out: Target[] = [];
    let i = 0;
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      if (el.closest('.sr-only, .skip-link, [inert], [aria-hidden="true"]')) continue;
      // checkVisibility: also false inside a closed <details> (content-visibility), which still has a layout box.
      if (!el.checkVisibility({ visibilityProperty: true })) continue;
      const input = el as HTMLInputElement;
      const label = el.tagName === 'INPUT' && (input.type === 'checkbox' || input.type === 'radio') ? el.closest('label') : null;
      const r = (label ?? el).getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // inside a closed <details>, or not rendered
      const block = el.parentElement?.closest('p, li, dd, td');
      const inline = el.tagName === 'A' && !!block && (block.textContent ?? '').trim().length > (el.textContent ?? '').trim().length + 1;
      el.setAttribute('data-pa', String(i));
      const name = el.getAttribute('aria-label') || (el.textContent ?? '').replace(/\s+/g, ' ').trim() || el.id || el.tagName;
      const top = r.top + scrollY;
      const left = r.left + scrollX;
      out.push({
        i: i++,
        desc: `${el.tagName.toLowerCase()} "${name.slice(0, 40)}" in .${(el.parentElement?.closest('[class]')?.className ?? '').toString().split(' ')[0]}`,
        w: r.width,
        h: r.height,
        cx: left + r.width / 2,
        cy: top + r.height / 2,
        inline,
        box: { l: left, t: top, r: left + r.width, b: top + r.height },
      });
    }
    return out;
  }, CONTROLS);
}

/** WCAG 2.2 2.5.8: >= 24x24, or inline, or a 24 px circle on its centre meets no other target (or its circle). */
function undersized(all: Target[]) {
  const small = (t: Target) => Math.round(t.w) < 24 || Math.round(t.h) < 24;
  const dist = (t: Target, x: number, y: number) => Math.hypot(Math.max(t.box.l - x, 0, x - t.box.r), Math.max(t.box.t - y, 0, y - t.box.b));
  return all
    .filter((t) => small(t) && !t.inline)
    .filter((t) => all.some((o) => o !== t && (small(o) ? Math.hypot(o.cx - t.cx, o.cy - t.cy) < 24 : dist(o, t.cx, t.cy) < 12)))
    .map((t) => `${t.desc} ${Math.round(t.w)}x${Math.round(t.h)}`);
}

/** Text that is clipped by its own box, or that runs past the viewport's right edge outside a scroll container. */
async function clippedText(page: Page) {
  return page.evaluate(() => {
    const bad: string[] = [];
    const vw = document.documentElement.clientWidth;
    const scrollsX = (e: Element | null): boolean => {
      for (let p = e; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === 'auto' || o === 'scroll') return true;
      }
      return false;
    };
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      if (el.closest('.sr-only, [aria-hidden="true"], script, style, noscript, svg')) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim() !== '');
      if (!own) continue;
      if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      const tag = `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} "${(el.textContent ?? '').trim().slice(0, 30)}"`;
      const clipX = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
      const clipY = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
      const ellipsis = cs.textOverflow === 'ellipsis';
      if (clipX && !ellipsis && el.scrollWidth > el.clientWidth + 1) bad.push(`${tag}: clipped horizontally (${el.scrollWidth} > ${el.clientWidth})`);
      if (clipY && el.scrollHeight > el.clientHeight + 1) bad.push(`${tag}: clipped vertically (${el.scrollHeight} > ${el.clientHeight})`);
      if (r.right > vw + 1 && !scrollsX(el)) bad.push(`${tag}: past the viewport edge (${Math.round(r.right)} > ${vw})`);
      if (r.left < -1 && !scrollsX(el)) bad.push(`${tag}: before the viewport's left edge (${Math.round(r.left)})`);
    }
    return bad;
  });
}

/** The add-mobile-e2e D3 audit on the current, settled screen. */
async function phoneAudit(page: Page, where: string) {
  const { sw, vw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth }));
  expect(sw, `${where}: horizontal page scroll`).toBeLessThanOrEqual(vw);

  const all = await targets(page);
  expect(all.length, `${where}: controls found`).toBeGreaterThan(0);
  expect(undersized(all), `${where}: targets under 24x24 (WCAG 2.5.8)`).toEqual([]);
  const advisory = all.filter((t) => !t.inline && (Math.round(t.w) < 44 || Math.round(t.h) < 44)).map((t) => `${t.desc} ${Math.round(t.w)}x${Math.round(t.h)}`);
  if (advisory.length) test.info().annotations.push({ type: 'advisory: under 44x44', description: `${where}: ${advisory.join('; ')}` });

  const untappable: string[] = [];
  for (const t of all) {
    const el = page.locator(`[data-pa="${t.i}"]`);
    if (!(await el.count())) continue; // the screen changed under us: re-audit is the caller's job
    try {
      await el.scrollIntoViewIfNeeded({ timeout: 3_000 });
      // A disabled control (e.g. Continue before key 2) cannot take a tap by design: check it is shown, uncovered.
      if (await el.isDisabled()) {
        const hit = await el.evaluate((e) => {
          const r = e.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !!top && (top === e || e.contains(top));
        });
        if (!hit) throw new Error('covered by another element (disabled control)');
      } else {
        await el.tap({ trial: true, timeout: 3_000 });
      }
    } catch (e) {
      untappable.push(`${t.desc}: ${(e as Error).message.split('\n').find((l) => /intercepts|not visible|outside|not stable|covered/.test(l))?.trim() ?? 'not tappable'}`);
      continue;
    }
    const box = await el.evaluate((e) => {
      const input = e as HTMLInputElement;
      const label = e.tagName === 'INPUT' && (input.type === 'checkbox' || input.type === 'radio') ? e.closest('label') : null;
      const r = (label ?? e).getBoundingClientRect();
      return { l: r.left, r: r.right, vw: document.documentElement.clientWidth, scrolls: (() => {
        for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
          const o = getComputedStyle(p).overflowX;
          if (o === 'auto' || o === 'scroll') return true;
        }
        return false;
      })() };
    });
    if (!box.scrolls && (box.l < -1 || box.r > box.vw + 1)) untappable.push(`${t.desc}: outside the viewport (${Math.round(box.l)}..${Math.round(box.r)} of ${box.vw})`);
  }
  expect(untappable, `${where}: controls not operable by tap`).toEqual([]);
  expect(await clippedText(page), `${where}: clipped or overflowing text`).toEqual([]);
  // A container that scrolls sideways on a phone must be reachable from the keyboard too (WCAG 2.1.1).
  const unreachable = await page.evaluate((sel) =>
    [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((e) => ['auto', 'scroll'].includes(getComputedStyle(e).overflowX) && e.scrollWidth > e.clientWidth + 1 && e.checkVisibility())
      .filter((e) => e.tabIndex < 0 && !e.querySelector(sel))
      .map((e) => `${e.tagName.toLowerCase()}.${e.className}`),
  CONTROLS);
  expect(unreachable, `${where}: sideways scroll containers the keyboard cannot reach`).toEqual([]);
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
}

const tap = async (l: Locator) => {
  await l.scrollIntoViewIfNeeded();
  await l.tap();
};

test('every page fits a phone: no horizontal scroll, every control tappable, targets >= 24 px, no clipped text', async ({ page }) => {
  test.setTimeout(240_000);
  for (const p of PAGES) {
    await page.goto(p);
    if (p === APP) await settled(page);
    await phoneAudit(page, p);
  }
});

test('the narrow menu, theme switch, a footer link and the primary CTA work by tap on every page', async ({ page }) => {
  test.setTimeout(240_000);
  for (const p of PAGES) {
    await page.goto(p);
    const nav = page.getByRole('navigation', { name: 'Site' });
    // Menu: the button is shown on a phone, opens inside the viewport, every item is tappable, a second tap closes it.
    const menu = nav.locator('details.nav-menu');
    const summary = menu.locator('summary');
    await expect(summary, p).toBeVisible();
    await tap(summary);
    await expect(menu, p).toHaveAttribute('open', '');
    const panel = menu.locator('ul');
    await expect(panel).toBeVisible();
    const box = await panel.evaluate((e) => {
      const r = e.getBoundingClientRect();
      return { l: r.left, r: r.right, b: r.bottom, vw: document.documentElement.clientWidth, vh: innerHeight };
    });
    expect(box.l, `${p} menu left`).toBeGreaterThanOrEqual(0);
    expect(box.r, `${p} menu right`).toBeLessThanOrEqual(box.vw);
    expect(box.b, `${p} menu bottom`).toBeLessThanOrEqual(box.vh);
    for (const a of await panel.getByRole('link').all()) {
      await a.tap({ trial: true, timeout: 5_000 });
      const r = (await a.boundingBox())!;
      expect(r.height, `${p} menu item height`).toBeGreaterThanOrEqual(44);
    }
    await tap(summary);
    await expect(menu, p).not.toHaveAttribute('open', '');

    // A menu item really navigates (same-page anchor on the landing page, the landing page elsewhere).
    if (p === LANDING) {
      await tap(summary);
      await tap(menu.getByRole('link', { name: 'FAQ' }));
      await expect(page).toHaveURL(/#faq$/);
      await expect(page.locator('#faq')).toBeInViewport();
    }

    // Theme switch: visible, tappable, Dark applies, System restores.
    await page.goto(p);
    const theme = nav.getByRole('combobox', { name: 'Theme' });
    await theme.tap({ trial: true });
    await theme.selectOption('dark');
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
    await theme.selectOption('system');
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme ?? null)).toBeNull();

    // A footer link to another page, by tap.
    const footer = page.getByRole('contentinfo');
    const [name, url] = p === '/devices' ? ['Buy me a coffee', /\/support$/] : ['Supported devices', /\/devices$/];
    await tap(footer.getByRole('link', { name, exact: true }).first());
    await expect(page, `${p} footer link`).toHaveURL(url);
  }

  // The landing CTAs reach the app by tap.
  for (const cta of [page.locator('.sub-nav').getByRole('link', { name: 'Open the app' }), page.locator('#hero').getByRole('link', { name: 'Open the app' })]) {
    await page.goto(LANDING);
    await tap(cta);
    await expect(page).toHaveURL(/\/app\/$/);
    await expect(page.getByRole('button', { name: 'Unlock my vault' })).toBeVisible();
  }
});

test('landing FAQ items open and close by tap; /support Copy address works by tap', async ({ page, context }) => {
  await page.goto(LANDING);
  const items = page.locator('#faq details');
  const n = await items.count();
  expect(n).toBeGreaterThan(5);
  for (let i = 0; i < n; i++) {
    const d = items.nth(i);
    await tap(d.locator('summary'));
    await expect(d).toHaveAttribute('open', '');
    await expect(d.locator('p').first()).toBeVisible();
  }
  await phoneAudit(page, '/ (FAQ open)');
  for (let i = 0; i < n; i++) {
    const d = items.nth(i);
    await tap(d.locator('summary'));
    await expect(d).not.toHaveAttribute('open', '');
  }

  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/support');
  await tap(page.getByRole('button', { name: 'Copy address' }));
  await expect(page.getByRole('status')).toHaveText('Address copied. Check it matches before you send.');
  await expect(page.getByRole('link', { name: 'Open in wallet' })).toBeInViewport();
});

test('the vault flow by tap: create with two keys, unlock, show, copy, every vault screen, add a key, lock', async ({ page, context }) => {
  test.setTimeout(360_000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const arweave = new ArweaveStub();
  await arweave.install(page);
  await page.goto(APP);
  const keys = await VirtualKeys.attach(page);
  await keys.add();
  await keys.add();
  const btn = (name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' });
  const screen = async (where: string) => {
    await settled(page);
    await phoneAudit(page, where);
  };

  await screen('app home');
  // Create, by tap only.
  await tap(btn('Create a new vault'));
  await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();
  await screen('create/intro');
  await tap(btn('Get started'));
  await expect(page.getByRole('heading', { name: 'Set up your keys' })).toBeVisible();
  await screen('create/keys');
  await keys.use(0);
  await tap(btn('Set up key 1'));
  await expect(page.getByText('Key 1 is ready.')).toBeVisible();
  await keys.use(1);
  await tap(btn('Set up key 2'));
  await expect(page.getByText('Key 2 is ready.')).toBeVisible();
  await screen('create/keys ready');
  await tap(btn('Continue'));
  await expect(page.getByRole('heading', { name: 'Add your secrets' })).toBeVisible();
  await page.getByLabel('Vault name (optional)').fill('Family savings vault');
  await page.locator('#label-0').fill('Bitcoin seed');
  await page.locator('#secret-0').fill('abandon ability able about above absent absorb abstract absurd abuse access accident');
  await tap(btn('Add another secret'));
  await page.locator('#label-1').fill('GitHub recovery codes');
  await page.locator('#secret-1').fill('aaaa-bbbb-cccc\ndddd-eeee-ffff');
  await tap(page.getByRole('checkbox', { name: /published permanently/ }));
  await tap(page.getByRole('checkbox', { name: 'I am 18 or over.' }));
  await screen('create/secrets');
  await keys.use(0);
  await tap(btn('Save'));
  await expect(page.getByRole('heading', { name: 'Your vault is saved' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Backup copy saved.')).toBeVisible({ timeout: 15_000 });
  await screen('create/saved');

  // Unlock by tap with key 2.
  await page.goto(APP);
  await keys.use(1);
  await tap(btn('Unlock my vault'));
  await screen('unlock');
  await tap(btn('Unlock with my key'));
  await expect(page.getByRole('heading', { name: 'Family savings vault', level: 1 })).toBeVisible({ timeout: 30_000 });
  await screen('vault');

  // Show and copy a secret.
  await tap(btn('Show Bitcoin seed'));
  await expect(page.locator('.secret-value pre').first()).toContainText('abandon ability');
  await tap(btn('Copy Bitcoin seed'));
  await expect(page.getByText('Clipboard clears in 30 s')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('abandon ability');
  await screen('vault (shown + copied)');

  // Where your vault is stored (recovery info).
  const where = btn('Where your vault is stored');
  await tap(where);
  await expect(where).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.vault-location')).toBeVisible();
  await screen('vault (location open)');
  await tap(where);
  await expect(where).toHaveAttribute('aria-expanded', 'false');

  // All vaults and back.
  await tap(btn(/^All vaults/));
  await expect(page.getByRole('heading', { name: 'Your vaults', level: 1 })).toBeVisible();
  await screen('all vaults');
  await tap(btn('Back to the vault'));
  await expect(page.getByRole('heading', { name: 'Family savings vault', level: 1 })).toBeVisible();

  // Details & backup file, download by tap, Close.
  await tap(btn('Details & backup file'));
  await expect(page.getByRole('heading', { name: 'Vault details' })).toBeVisible();
  await screen('details');
  const [download] = await Promise.all([page.waitForEvent('download'), tap(btn('Download encrypted backup file'))]);
  expect(download.suggestedFilename()).toMatch(/^cryoshield-[0-9a-f]{8}\.cryo$/);
  await tap(btn('Close'));

  // Rename or archive, then Cancel.
  await tap(btn('Rename or archive'));
  await expect(page.getByRole('heading', { name: 'Edit vault' })).toBeVisible();
  await screen('edit vault');
  await tap(btn('Cancel'));
  await expect(page.getByRole('heading', { name: 'Family savings vault', level: 1 })).toBeVisible();

  // Edit secrets, then Cancel.
  await tap(btn('Edit secrets'));
  await expect(page.getByRole('heading', { name: 'Edit secrets' })).toBeVisible();
  await screen('edit secrets');
  await tap(btn('Cancel'));

  // Add a third key by tap.
  const k3 = await keys.add();
  await keys.use(1);
  await tap(btn('Add a key'));
  await expect(page.getByRole('heading', { name: 'Add a key' })).toBeVisible();
  await screen('add a key');
  await tap(btn('Add a key'));
  await expect(page.getByText('Now insert your new key', { exact: false })).toBeVisible({ timeout: 15_000 });
  await screen('add a key/new key');
  await keys.use(k3);
  await tap(btn('Continue'));
  await expect(page.getByText('Put your current key back', { exact: false })).toBeVisible({ timeout: 15_000 });
  await keys.use(1);
  await tap(btn('Continue'));
  await expect(page.getByText('Your new key is ready', { exact: false })).toBeVisible({ timeout: 60_000 });
  await screen('add a key/done');

  // Lock from the header bar, then the third key opens the vault.
  await tap(btn('Lock'));
  await expect(page.getByText('Your vault is locked.')).toBeVisible();
  await screen('locked');
  await page.goto(APP);
  await keys.use(k3);
  await tap(btn('Unlock my vault'));
  await tap(btn('Unlock with my key'));
  await expect(page.getByRole('heading', { name: 'Family savings vault', level: 1 })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'GitHub recovery codes' })).toBeVisible();
});


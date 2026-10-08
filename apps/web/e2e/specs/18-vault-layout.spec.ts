/** align-vault-sections 1.1 (spec vault-web-app "Vault view column alignment"): every block of the open vault shares
 *  the content column's edges, at desktop and phone width; the location card expands inside itself. */
import { expect, test } from '@playwright/test';
import { APP } from '../fixtures/routes';
import { ArweaveStub } from '../fixtures/arweave';
import { VirtualKeys } from '../fixtures/webauthn';
import { createVault } from '../fixtures/app';
import { settled } from '../fixtures/motion';

const BLOCKS = ['.secrets', '.action-bar', '.group-list', '.vault-nav button', '.vault-location-disclosure'];

for (const width of [1024, 390]) {
  test(`open vault blocks share the column edges at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await new ArweaveStub().install(page);
    await page.goto(APP);
    const keys = await VirtualKeys.attach(page);
    await keys.add();
    await keys.add();
    await createVault(page, keys, [{ label: 'Bitcoin seed', secret: 'abandon ability able about' }]);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('button', { name: /^All vaults/ })).toBeVisible();
    await settled(page);

    const edges = async () => page.evaluate((sels) => {
      const box = (el: Element) => el.getBoundingClientRect();
      const main = document.querySelector('.app-main')!;
      const cs = getComputedStyle(main);
      const m = box(main);
      const column = { left: m.left + parseFloat(cs.paddingLeft), right: m.right - parseFloat(cs.paddingRight) };
      const blocks = sels.map((s) => {
        const el = document.querySelector(s);
        return { s, left: el ? box(el).left : NaN, right: el ? box(el).right : NaN };
      });
      const footer = document.querySelector('.app-footer ul')!;
      const fcs = getComputedStyle(footer);
      const ruled = fcs.borderTopWidth !== '0px' ? box(footer) : box(document.querySelector('.app-footer')!);
      return { column, blocks, footer: { left: ruled.left, right: ruled.right } };
    }, BLOCKS);

    const check = (r: Awaited<ReturnType<typeof edges>>) => {
      for (const b of r.blocks) {
        expect(Math.abs(b.left - r.column.left), `${b.s} left`).toBeLessThanOrEqual(1);
        expect(Math.abs(b.right - r.column.right), `${b.s} right`).toBeLessThanOrEqual(1);
      }
      expect(Math.abs(r.footer.left - r.column.left), 'footer divider left').toBeLessThanOrEqual(1);
      expect(Math.abs(r.footer.right - r.column.right), 'footer divider right').toBeLessThanOrEqual(1);
    };
    check(await edges());

    // Expanded, the details sit inside the one card: no second border.
    await page.getByRole('button', { name: 'Where your vault is stored' }).click();
    await expect(page.locator('.vault-location')).toBeVisible();
    await settled(page);
    check(await edges());
    expect(await page.locator('.vault-location').evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('0px');
  });
}

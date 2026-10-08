/** vault-view-action-layout 1.1: the open vault's actions in three groups (primary, Manage vault, navigation). */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ops from '../../src/ui/operations';
import { ServicesProvider } from '../../src/ui/services';
import { S } from '../../src/ui/strings';
import { VaultView } from '../../src/ui/VaultView';
import { fakeServices } from './helpers';

const credIds = [new Uint8Array(48).fill(1), new Uint8Array(48).fill(2)];
const session = (over: Partial<ops.VaultSession> = {}): ops.VaultSession => ({
  vaultId: ('0x' + '12'.repeat(32)) as `0x${string}`,
  owner: ('0x' + '34'.repeat(20)) as `0x${string}`,
  version: 1,
  blob: new Uint8Array(4),
  items: [{ label: 'Bitcoin seed', secret: 'abandon art' }],
  archived: false,
  credIds,
  registry: 'v2',
  ...over,
});

function show(over: Partial<ops.VaultSession> = {}, props: { onAllVaults?: () => void; onLock?: () => void } = {}) {
  return render(
    <ServicesProvider value={fakeServices()}>
      <VaultView session={session(over)} locator="0x" onChange={() => {}} onLock={props.onLock ?? (() => {})} vaultCount={3} {...(props.onAllVaults ? { onAllVaults: props.onAllVaults } : {})} />
    </ServicesProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(ops, 'ensureMirror').mockResolvedValue({ status: 'saved' });
});
afterEach(() => vi.restoreAllMocks());

const manage = () => screen.getByRole('heading', { name: S.vault.manage, level: 2 });
const rows = () => within(manage().nextElementSibling as HTMLElement).getAllByRole('button');

describe('vault actions layout', () => {
  it('uses the new labels', () => {
    expect(S.vault.edit).toBe('Edit secrets');
    expect(S.vault.editVault).toBe('Rename or archive');
    expect(S.vault.addKey).toBe('Add a key');
    expect(S.vault.details).toBe('Details & backup file');
    expect(S.vault.manage).toBe('Manage vault');
  });

  it('one primary Edit secrets alone in the floating bar', () => {
    show({}, { onAllVaults: () => {} });
    const edit = screen.getByRole('button', { name: S.vault.edit });
    const bar = edit.closest('.action-bar')!;
    expect(bar).not.toBeNull();
    expect(bar.querySelectorAll('button')).toHaveLength(1);
    expect(edit).not.toHaveClass('secondary');
  });

  it('Manage vault: an h2 over a list of row buttons with an aria-hidden chevron', () => {
    show();
    const list = manage().nextElementSibling as HTMLElement;
    expect(list.tagName).toBe('UL');
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(rows().map((b) => b.textContent)).toEqual([S.vault.editVault, S.vault.addKey, S.vault.details]);
    for (const b of rows()) {
      expect(b.parentElement!.tagName).toBe('LI');
      const chevron = b.querySelector('.disclosure-chevron')!;
      expect(chevron).toHaveAttribute('aria-hidden', 'true');
      expect(b).toHaveAccessibleName(b.textContent!);
    }
  });

  it('keyboard order: Edit secrets, the rows, All vaults, Lock', async () => {
    const u = userEvent.setup();
    show({}, { onAllVaults: () => {} });
    screen.getByRole('button', { name: S.vault.edit }).focus();
    const order = [S.vault.editVault, S.vault.addKey, S.vault.details, S.vault.allVaults(3), S.vault.lock];
    for (const name of order) {
      await u.tab();
      expect(document.activeElement).toBe(screen.getByRole('button', { name }));
    }
  });

  it('All vaults and Lock form the navigation row, outside the floating bar and the list', () => {
    show({}, { onAllVaults: () => {} });
    const all = screen.getByRole('button', { name: S.vault.allVaults(3) });
    const lock = screen.getByRole('button', { name: S.vault.lock });
    expect(all.parentElement).toBe(lock.parentElement);
    expect(lock.closest('.action-bar')).toBeNull();
    expect(lock.closest('ul')).toBeNull();
  });

  it('without a vault list: no All vaults, Lock alone', () => {
    show();
    expect(screen.queryByRole('button', { name: /^All vaults/ })).toBeNull();
    expect(screen.getByRole('button', { name: S.vault.lock }).parentElement!.querySelectorAll('button')).toHaveLength(1);
  });

  it('read-only: no Edit secrets, Rename or archive or Add a key; Details stays', () => {
    show({ registry: 'v1' });
    expect(screen.queryByRole('button', { name: S.vault.edit })).toBeNull();
    expect(document.querySelector('.action-bar')).toBeNull(); // no empty floating bar
    expect(rows().map((b) => b.textContent)).toEqual([S.vault.details]);
  });

  it('each row opens its screen, and Lock locks', async () => {
    const u = userEvent.setup();
    const onLock = vi.fn();
    show({}, { onLock });
    await u.click(screen.getByRole('button', { name: S.vault.addKey }));
    expect(await screen.findByRole('heading', { name: S.addKey.title })).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: S.back }));
    await u.click(await screen.findByRole('button', { name: S.vault.details }));
    expect(await screen.findByRole('heading', { name: S.details.title })).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: S.details.close }));
    await u.click(await screen.findByRole('button', { name: S.vault.editVault }));
    expect(await screen.findByRole('heading', { name: 'Edit vault' })).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: S.editor.cancel }));
    await u.click(await screen.findByRole('button', { name: S.vault.lock }));
    expect(onLock).toHaveBeenCalledOnce();
  });

  it('has no axe violations', async () => {
    const { container } = show({}, { onAllVaults: () => {} });
    const r = await axe.run(container, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'], rules: { 'color-contrast': { enabled: false } } });
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
});

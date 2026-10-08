/**
 * ECC review of dc4cdd6 (MEDIUM): a v3 vault through the UI with v3 configured (the 3-registry fixture). Unlock opens
 * the single active v3 vault directly; in the vault list it is active and editable, and the v2 vault is in the older,
 * read-only group.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';

const A3 = '0x00000000000000000000000000000000000000a3' as Hex;
const id = (n: number) => new Uint8Array(48).fill(n);
const hex = (n: number) => ('0x' + n.toString(16).padStart(2, '0').repeat(32)) as Hex;
const vault = (n: number, registry: `v${number}`, name: string) => ({
  vaultId: hex(n),
  owner: ('0x' + '34'.repeat(20)) as Hex,
  version: 1,
  blob: new Uint8Array(400).fill(n),
  items: [{ label: `Label ${n}`, secret: `SECRET-${n}` }],
  name,
  archived: false,
  entryIndex: 0,
  registry,
});

beforeEach(async () => {
  vi.resetModules();
  const base = (await import('../fixtures/virtual-config')).config;
  vi.doMock('virtual:cryoshield-config', () => ({
    config: Object.freeze({ ...base, registries: [{ version: 'v3', abi: 2, address: A3, deployBlock: 12 }, ...base.registries] }),
  }));
});
afterEach(() => {
  vi.doUnmock('virtual:cryoshield-config');
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('a v3 vault through unlock and the vault list', () => {
  it('opens directly, is editable, and the v2 vault is listed as older and read-only', async () => {
    const { screen, within } = await import('@testing-library/react');
    const userEvent = (await import('@testing-library/user-event')).default;
    const unlockMod = await import('../../src/chain/unlock');
    const ops = await import('../../src/ui/operations');
    const { VAULTS } = await import('../../src/ui/strings-vaults');
    const { renderApp } = await import('./helpers');
    vi.spyOn(ops, 'ensureMirror').mockResolvedValue({ status: 'saved' });
    vi.spyOn(await import('@cryoshield/vault-crypto'), 'decodeVault').mockReturnValue({ entries: [{ credId: id(1) }, { credId: id(2) }] } as never);
    vi.spyOn(unlockMod, 'unlock').mockResolvedValue({ credId: id(1), locator: new Uint8Array(32), matches: [vault(1, 'v3', 'Main'), vault(2, 'v2', 'Before v3')] });
    const u = userEvent.setup();
    renderApp({ registries: [{ version: 'v3', address: A3 }] });
    await u.click(screen.getByRole('button', { name: 'Unlock my vault' }));
    await u.click(screen.getByRole('button', { name: 'Unlock with my key' }));
    // The one active vault in the newest registry opens by itself, writable.
    expect(await screen.findByRole('heading', { level: 1, name: 'Main' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit secrets' })).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'All vaults (2)' }));
    const active = await screen.findByRole('region', { name: VAULTS.groupActive });
    expect(within(active).getByRole('heading', { name: 'Main' })).toBeInTheDocument();
    expect(within(active).getByRole('button', { name: /Edit vault/ })).toBeInTheDocument();
    expect(within(active).queryByRole('heading', { name: 'Before v3' })).toBeNull();
    // Menu mode lists every group expanded.
    const older = await screen.findByRole('region', { name: VAULTS.groupOlder });
    expect(within(older).getByRole('heading', { name: 'Before v3' })).toBeInTheDocument();
    expect(within(older).queryByRole('button', { name: /Edit vault/ })).toBeNull();
    // Opening the v2 vault: read-only, no edit actions.
    await u.click(within(older).getByRole('button', { name: /Open/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Before v3' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit secrets' })).toBeNull();
  });
});

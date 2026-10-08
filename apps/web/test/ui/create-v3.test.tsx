/**
 * ECC review of dc4cdd6 (HIGH): with a v3 configured (the 3-registry fixture: a fake v3 with v2's interface), a new
 * vault is tagged with the newest registry, not a literal 'v2'. Create through the UI (the real saveNewVault, with the
 * write stack faked), open it, edit it and mirror it: it is writable and every registry-scoped call names v3.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';

const A3 = '0x00000000000000000000000000000000000000a3' as Hex;
const OWNER = ('0x' + '34'.repeat(20)) as Hex;
const VAULT_ID = ('0x' + '12'.repeat(32)) as Hex;
const id = (n: number) => new Uint8Array(48).fill(n);
const key = (n: number) => ({ credId: id(n), publicKey: ('0x' + 'aa'.repeat(64)) as Hex, prf: new Uint8Array(32).fill(n) });

beforeEach(async () => {
  vi.resetModules();
  const base = (await import('../fixtures/virtual-config')).config;
  vi.doMock('virtual:cryoshield-config', () => ({
    config: Object.freeze({ ...base, registries: [{ version: 'v3', abi: 2, address: A3, deployBlock: 12 }, ...base.registries] }),
  }));
  vi.doMock('../../src/account/stack', async () => ({
    newVaultAccount: async () => ({ getAddress: async () => OWNER }),
    createVaultOnChain: async ({ build }: { build: (id: Hex) => Promise<{ blob: Uint8Array; locators: Hex[] }> }) => {
      const { blob, locators } = await build(VAULT_ID);
      return { vaultId: VAULT_ID, owner: OWNER, version: 1, blob, locators, txHash: ('0x' + 'cd'.repeat(32)) as Hex };
    },
  }));
});
afterEach(() => {
  vi.doUnmock('virtual:cryoshield-config');
  vi.doUnmock('../../src/account/stack');
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('a vault created with v3 configured', () => {
  it('saveNewVault tags it v3 (WRITE_REGISTRY), not v2', async () => {
    const ops = await import('../../src/ui/operations');
    const { fakeServices } = await import('./helpers');
    const { session } = await ops.saveNewVault(fakeServices(), [key(1), key(2)], [{ label: 'Seed', secret: 'abandon art' }], () => {});
    expect(session.registry).toBe('v3');
    expect(ops.isReadOnly(session)).toBe(false);
  });

  it('UI: create, open (writable), edit and mirror all name v3', async () => {
    const { screen } = await import('@testing-library/react');
    const userEvent = (await import('@testing-library/user-event')).default;
    const ops = await import('../../src/ui/operations');
    const { acknowledge, renderApp } = await import('./helpers');
    vi.spyOn(ops, 'enrollWithPrf').mockImplementation(async (_s, n) => key(n));
    const mirror = vi.spyOn(ops, 'mirrorWrite').mockResolvedValueOnce({ status: 'saved' }).mockResolvedValue({ status: 'failed' });
    const ensure = vi.spyOn(ops, 'ensureMirror').mockResolvedValue({ status: 'saved' });
    const edit = vi.spyOn(ops, 'saveEdit').mockImplementation(async (_svc, s, items) => ({ ...s, items, version: s.version + 1 }));
    vi.spyOn(await import('@cryoshield/vault-crypto'), 'decodeVault').mockReturnValue({ entries: [{ credId: id(1) }, { credId: id(2) }] } as never);
    const u = userEvent.setup();
    renderApp({ registries: [{ version: 'v3', address: A3 }] });
    await u.click(screen.getByRole('button', { name: 'Create a new vault' }));
    await u.click(screen.getByRole('button', { name: 'Get started' }));
    await u.click(screen.getByRole('button', { name: 'Set up key 1' }));
    await screen.findByText('Key 1 is ready.');
    await u.click(screen.getByRole('button', { name: 'Set up key 2' }));
    await screen.findByText('Key 2 is ready.');
    await u.click(screen.getByRole('button', { name: 'Continue' }));
    await u.type(screen.getByLabelText('Secret'), 'abandon art');
    await acknowledge(u);
    await u.click(screen.getByRole('button', { name: 'Save' }));
    await u.click(await screen.findByRole('button', { name: 'Continue' }));
    // Opened and writable: the edit actions are offered, and no read-only notice.
    await u.click(await screen.findByRole('button', { name: 'Edit secrets' }));
    expect(screen.queryByText(/older, read-only format/)).toBeNull();
    await u.click(await screen.findByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(edit).toHaveBeenCalled());
    expect(edit.mock.calls[0]![1]).toMatchObject({ registry: 'v3', vaultId: VAULT_ID });
    // The edit's mirror upload fails; Retry looks up this vault's locators in ITS registry (v3).
    await vi.waitFor(() => expect(mirror.mock.calls.some((c) => c[1].version === 2)).toBe(true));
    mirror.mockResolvedValue({ status: 'saved' });
    await u.click(await screen.findByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => expect(mirror.mock.calls.at(-1)![1]).toMatchObject({ vaultId: VAULT_ID, registry: 'v3' }));
    for (const c of ensure.mock.calls) expect(c[1].registry).toBe('v3');
  });
});

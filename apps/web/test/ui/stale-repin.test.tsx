/**
 * web-review-followups 3 (review WB3, N2): no false "changed since you opened it" (STALE).
 * - The session's nonce is pinned only when the chain still holds the session's blob (at open, and after every write
 *   attempt), and the pin never goes down; so a failed save that used up a nonce, or a lagging RPC, can't fake STALE.
 * - A real STALE offers "Reload vault" (one key tap) instead of a dead end.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as ops from '../../src/ui/operations';
import * as unlockMod from '../../src/chain/unlock';
import { WriteError } from '../../src/account/errors';
import { S } from '../../src/ui/strings';
import { renderApp } from './helpers';

const id = (n: number) => new Uint8Array(48).fill(n);
const VAULT_ID = ('0x' + '12'.repeat(32)) as `0x${string}`;
const OWNER = ('0x' + '34'.repeat(20)) as `0x${string}`;
const BLOB = new Uint8Array(400).fill(1);
const opened = (label = 'Seed', version = 1, blob = BLOB) => ({
  vaultId: VAULT_ID,
  owner: OWNER,
  version,
  blob,
  items: [{ label, secret: 'abandon art' }],
  archived: false,
  entryIndex: 0,
  registry: 'v2' as const,
});
let chain: { nonce: bigint; blob: Uint8Array };
const client = { request: async ({ method }: { method: string }) => (method === 'eth_call' ? '0x' + chain.nonce.toString(16) : Promise.reject(new Error(method))) };
const reader = { getVault: async () => ({ vaultId: VAULT_ID, owner: OWNER, blob: chain.blob, version: 1, registry: 'v2' as const }) };

beforeEach(async () => {
  vi.restoreAllMocks();
  chain = { nonce: 5n, blob: BLOB };
  vi.spyOn(await import('@cryoshield/vault-crypto'), 'decodeVault').mockReturnValue({ entries: [{ credId: id(1) }, { credId: id(2) }] } as never);
  vi.spyOn(ops, 'mirrorWrite').mockResolvedValue({ status: 'saved' });
  vi.spyOn(ops, 'ensureMirror').mockResolvedValue({ status: 'saved' });
});

async function openVault() {
  const unlock = vi.spyOn(unlockMod, 'unlock').mockResolvedValue({ credId: id(1), locator: new Uint8Array(32), matches: [opened()] });
  const u = userEvent.setup();
  renderApp({ client: client as never, reader: reader as never });
  await u.click(screen.getByRole('button', { name: 'Unlock my vault' }));
  await u.click(screen.getByRole('button', { name: 'Unlock with my key' }));
  await screen.findByRole('heading', { name: 'Seed' });
  return { u, unlock };
}
/** Opens the editor if it isn't open (a failed save keeps it open, with the unsaved text), then saves. */
async function save(u: ReturnType<typeof userEvent.setup>) {
  const edit = screen.queryByRole('button', { name: S.vault.edit });
  if (edit) await u.click(edit);
  await u.click(await screen.findByRole('button', { name: 'Save' }));
}

describe('WB3: a retry after a failed save is not a false STALE', () => {
  it('the nonce a failed (included, reverted) save used up is re-pinned from the chain before the retry', async () => {
    const edit = vi
      .spyOn(ops, 'saveEdit')
      .mockImplementationOnce(async () => {
        chain.nonce = 6n; // included but reverted: the nonce is used, the blob is unchanged
        throw new WriteError('REVERTED');
      })
      .mockImplementationOnce(async (_svc, s, items) => ({ ...s, items, version: 2, nonce: (s.nonce ?? 0n) + 1n }));
    const { u } = await openVault();
    await waitFor(() => expect(true).toBe(true));
    await save(u);
    await screen.findByRole('alert');
    expect(edit.mock.calls[0]![1].nonce).toBe(5n);
    await save(u);
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(2));
    expect(edit.mock.calls[1]![1].nonce).toBe(6n);
  });

  it('N2: no pin at open while the RPC still shows another blob (lagging right after a write)', async () => {
    chain.blob = new Uint8Array(400).fill(9);
    const edit = vi.spyOn(ops, 'saveEdit').mockImplementation(async (_svc, s, items) => ({ ...s, items, version: 2 }));
    const { u } = await openVault();
    await save(u);
    await waitFor(() => expect(edit).toHaveBeenCalled());
    expect(edit.mock.calls[0]![1].nonce).toBeUndefined(); // assertCurrent then reads the nonce fresh
  });

  it('after a successful save, a lagging RPC never lowers the pin', async () => {
    const edit = vi.spyOn(ops, 'saveEdit').mockImplementation(async (_svc, s, items) => ({ ...s, items, version: s.version + 1, blob: new Uint8Array(400).fill(s.version + 1), nonce: (s.nonce ?? 0n) + 1n }));
    const { u } = await openVault();
    await waitFor(() => expect(true).toBe(true));
    await save(u);
    await screen.findByText(S.save.saved);
    await save(u); // the RPC still answers nonce 5 and the old blob
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(2));
    expect(edit.mock.calls[1]![1].nonce).toBe(6n);
  });
});

describe('STALE offers "Reload vault"', () => {
  it('reloads the vault with one unlock and shows the current version', async () => {
    vi.spyOn(ops, 'saveEdit').mockRejectedValue(new WriteError('STALE'));
    const { u, unlock } = await openVault();
    await save(u);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(S.save.stale);
    unlock.mockResolvedValueOnce({ credId: id(1), locator: new Uint8Array(32), matches: [opened('Changed elsewhere', 3, new Uint8Array(400).fill(3))] });
    await u.click(screen.getByRole('button', { name: S.save.reload }));
    expect(await screen.findByRole('heading', { name: 'Changed elsewhere' })).toBeInTheDocument();
    expect(screen.queryByText(S.save.stale)).toBeNull();
  });

  it('a reload whose key no longer opens this vault says so and keeps the session', async () => {
    vi.spyOn(ops, 'saveEdit').mockRejectedValue(new WriteError('STALE'));
    const { u, unlock } = await openVault();
    await save(u);
    await screen.findByRole('alert');
    unlock.mockRejectedValueOnce(new unlockMod.UnlockError('NO_VAULT'));
    await u.click(screen.getByRole('button', { name: S.save.reload }));
    expect(await screen.findByText(S.save.reloadMissing)).toBeInTheDocument();
    // The session and the unsaved edit are kept; Reload is still offered.
    expect(screen.getByRole('button', { name: S.save.reload })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});

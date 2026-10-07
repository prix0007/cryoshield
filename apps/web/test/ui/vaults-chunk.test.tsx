/** Review M6: the vault list chunk fails to load. Plain copy with "reload the page", Try again, Back/Cancel and Lock. */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ops from '../../src/ui/operations';
import * as unlockMod from '../../src/chain/unlock';
import { S } from '../../src/ui/strings';
import { renderApp } from './helpers';

const tries = vi.hoisted(() => ({ n: 0 }));
vi.mock('../../src/ui/VaultsMenu', () => {
  tries.n++;
  throw new TypeError('Failed to fetch dynamically imported module');
});

const id = (n: number) => new Uint8Array(48).fill(n);
const vault = (n: number) => ({
  vaultId: ('0x' + String(n).repeat(64)) as `0x${string}`,
  owner: ('0x' + '34'.repeat(20)) as `0x${string}`,
  version: 1,
  blob: new Uint8Array(400),
  items: [{ label: `Label ${n}`, secret: 's' }],
  archived: false,
  entryIndex: 0,
  registry: 'v2' as const,
});

beforeEach(async () => {
  tries.n = 0;
  vi.spyOn(ops, 'ensureMirror').mockResolvedValue({ status: 'saved' });
  vi.spyOn(await import('@cryoshield/vault-crypto'), 'decodeVault').mockReturnValue({ entries: [{ credId: id(1) }, { credId: id(2) }] } as never);
});
afterEach(() => vi.restoreAllMocks());

async function open(matches: ReturnType<typeof vault>[]) {
  vi.spyOn(unlockMod, 'unlock').mockResolvedValue({ credId: id(1), locator: new Uint8Array(32), matches });
  const u = userEvent.setup();
  renderApp();
  await u.click(screen.getByRole('button', { name: 'Unlock my vault' }));
  await u.click(screen.getByRole('button', { name: 'Unlock with my key' }));
  return u;
}

describe('the vault list chunk fails to load', () => {
  it('picker: the plain message, Try again (imports again) and Lock; nothing crashes', async () => {
    const u = await open([vault(1), vault(2)]);
    expect(await screen.findByText(S.chunkFailed)).toBeInTheDocument();
    expect(S.chunkFailed).toMatch(/reload the page/);
    expect(screen.queryByRole('button', { name: S.back })).toBeNull(); // no vault open to go back to
    await u.click(screen.getByRole('button', { name: S.save.retry }));
    expect(await screen.findByText(S.chunkFailed)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: S.vault.lock }));
    expect(await screen.findByText(S.vault.locked)).toBeInTheDocument();
  });

  it('menu: Back returns to the open vault', async () => {
    const u = await open([vault(1)]);
    await u.click(await screen.findByRole('button', { name: S.vault.allVaults(1) }));
    await u.click(await screen.findByRole('button', { name: S.back }));
    expect(await screen.findByRole('button', { name: S.vault.allVaults(1) })).toBeInTheDocument();
  });

  it('Edit vault sheet: Cancel returns to the vault, Lock locks', async () => {
    const u = await open([vault(1)]);
    await u.click(await screen.findByRole('button', { name: S.vault.editVault }));
    expect(await screen.findByText(S.chunkFailed)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: S.editor.cancel }));
    await u.click(await screen.findByRole('button', { name: S.vault.editVault }));
    expect(await screen.findByText(S.chunkFailed)).toBeInTheDocument();
    await u.click(screen.getAllByRole('button', { name: S.vault.lock }).at(-1)!); // the fallback's Lock (the vault's own is below)
    await waitFor(() => expect(screen.getByText(S.vault.locked)).toBeInTheDocument());
  });
});

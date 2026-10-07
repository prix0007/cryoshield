/** show-vault-onchain-location review fix: a failed lazy chunk load must not take down the unlocked vault. */
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ops from '../../src/ui/operations';
import * as unlockMod from '../../src/chain/unlock';
import { S } from '../../src/ui/strings';
import { renderApp } from './helpers';

vi.mock('../../src/ui/VaultLocation', () => {
  throw new TypeError('Failed to fetch dynamically imported module');
});

beforeEach(async () => {
  vi.spyOn(ops, 'ensureMirror').mockResolvedValue({ status: 'saved' });
  vi.spyOn(await import('@cryoshield/vault-crypto'), 'decodeVault').mockReturnValue({ entries: [{ credId: new Uint8Array(48).fill(1) }] } as never);
  vi.spyOn(console, 'error').mockImplementation(() => undefined); // React reports the caught error
});
afterEach(() => vi.restoreAllMocks());

describe('Where your vault is stored: chunk load failure', () => {
  it('shows a one-line hint and keeps the vault usable', async () => {
    vi.spyOn(unlockMod, 'unlock').mockResolvedValue({
      credId: new Uint8Array(48).fill(1),
      locator: new Uint8Array(32),
      matches: [{ vaultId: ('0x' + '12'.repeat(32)) as `0x${string}`, owner: ('0x' + '34'.repeat(20)) as `0x${string}`, version: 1, blob: new Uint8Array(400), items: [{ label: 'Seed', secret: 'abandon art' }], entryIndex: 0, registry: 'v2' }],
    });
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Unlock my vault' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unlock with my key' }));
    await screen.findByRole('heading', { name: 'Seed' });
    fireEvent.click(screen.getByRole('button', { name: S.location.title }));
    expect(await screen.findByText(S.location.failed)).toBeInTheDocument();
    // The rest of the vault is still there and works.
    expect(screen.getByRole('heading', { name: 'Seed' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show Seed' }));
    expect(screen.getByText('abandon art')).toBeInTheDocument();
  });
});

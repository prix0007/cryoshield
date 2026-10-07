/**
 * harden-gas-sponsorship 5.5: the write-stack chunk fails to load once (a dropped connection), then loads. The second
 * press of Save really saves: the stack is imported again and the sponsored write is sent.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import * as ops from '../../src/ui/operations';
import { S } from '../../src/ui/strings';
import { acknowledge, renderApp } from './helpers';

const state = vi.hoisted(() => ({ imports: 0 }));

vi.mock('../../src/account/stack', () => {
  state.imports += 1;
  if (state.imports === 1) throw new TypeError('Failed to fetch dynamically imported module');
  const owner = ('0x' + '34'.repeat(20)) as Hex;
  return {
    newVaultAccount: async () => ({ getAddress: async () => owner }),
    existingVaultAccount: async () => ({ getAddress: async () => owner }),
    createVaultOnChain: async (p: { account: unknown }, deps: { onSign?: () => void | Promise<void>; sponsor: { send: (...a: unknown[]) => Promise<unknown> } }) => {
      await deps.onSign?.();
      await deps.sponsor.send(p.account, []);
      return { vaultId: ('0x' + '12'.repeat(32)) as Hex, owner, version: 1, blob: new Uint8Array(400), userOpHash: '0x01' as Hex, locators: [] };
    },
    updateVaultOnChain: async () => {
      throw new Error('not used');
    },
    addKeyOnChain: async () => {
      throw new Error('not used');
    },
    createSponsor: () => ({ send: async () => ({ userOpHash: '0x01', success: true }) }),
  };
});

const id = (n: number) => new Uint8Array(48).fill(n);
const key = (n: number) => ({ credId: id(n), publicKey: ('0x' + 'aa'.repeat(64)) as Hex, prf: new Uint8Array(32).fill(n) });

afterEach(() => vi.restoreAllMocks());

describe('the save code fails to load once, then loads', () => {
  it('create: the first Save shows the retryable error; the second Save imports again and saves', async () => {
    const u = userEvent.setup();
    const sponsor = { send: vi.fn(async () => ({ userOpHash: '0x01' as Hex, success: true })) };
    vi.spyOn(ops, 'mirrorWrite').mockResolvedValue({ status: 'saved' });
    vi.spyOn(ops, 'enrollWithPrf').mockImplementation(async (_s, n) => key(n));
    renderApp({ sponsor });
    await u.click(screen.getByRole('button', { name: 'Create a new vault' }));
    await u.click(screen.getByRole('button', { name: 'Get started' }));
    await u.click(screen.getByRole('button', { name: 'Set up key 1' }));
    await screen.findByText('Key 1 is ready.');
    await u.click(screen.getByRole('button', { name: 'Set up key 2' }));
    await screen.findByText('Key 2 is ready.');
    await u.click(screen.getByRole('button', { name: 'Continue' }));
    await u.type(screen.getByLabelText('Name'), 'Bitcoin seed');
    await u.type(screen.getByLabelText('Secret'), 'abandon art');
    await acknowledge(u);

    await u.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Nothing was saved'); // the notice title (ceremony.ts)
    expect(alert).toHaveTextContent(S.save.loadFailed);
    expect(sponsor.send).not.toHaveBeenCalled();
    expect(state.imports).toBe(1);

    await u.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { name: 'Your vault is saved' })).toBeInTheDocument();
    expect(state.imports).toBe(2);
    expect(sponsor.send).toHaveBeenCalledTimes(1);
  });
});

/**
 * harden-gas-sponsorship 5.5, security review LOW 1: the write stack is loaded before the "touch your key" prompt
 * (onSign), so no chunk fetch sits between the prompt and the signing ceremony inside the sponsor's send().
 */
import { describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import { lazySponsor } from '../../src/account/lazy';
import { saveNewVault } from '../../src/ui/operations';
import { fakeServices } from '../ui/helpers';

const events = vi.hoisted(() => [] as string[]);

vi.mock('../../src/account/stack', () => {
  events.push('import');
  const owner = ('0x' + '34'.repeat(20)) as Hex;
  return {
    newVaultAccount: async () => (events.push('account'), { getAddress: async () => owner }),
    existingVaultAccount: async () => ({ getAddress: async () => owner }),
    createVaultOnChain: async (p: { account: unknown }, deps: { onSign?: () => void | Promise<void>; sponsor: { send: (...a: unknown[]) => Promise<unknown> } }) => {
      await deps.onSign?.();
      await deps.sponsor.send(p.account, []);
      return { vaultId: ('0x' + '12'.repeat(32)) as Hex, owner, version: 1, blob: new Uint8Array(4), userOpHash: '0x01' as Hex, locators: [] };
    },
    updateVaultOnChain: async () => undefined,
    addKeyOnChain: async () => undefined,
    createSponsor: () => ({ send: async () => (events.push('send'), { userOpHash: '0x01', success: true }) }),
  };
});

describe('write stack load order', () => {
  it('create: the stack is imported once, before the account, the prompt and the send', async () => {
    const svc = fakeServices({ sponsor: lazySponsor({} as never) }); // the real app sponsor over the real loader
    const keys = [1, 2].map((n) => ({ credId: new Uint8Array(48).fill(n), publicKey: ('0x' + 'aa'.repeat(64)) as Hex, prf: new Uint8Array(32).fill(n) }));
    await saveNewVault(svc, keys, [{ label: 'a', secret: 'b' }], () => void events.push('onSign'));
    expect(events).toEqual(['import', 'account', 'onSign', 'send']);
  });
});

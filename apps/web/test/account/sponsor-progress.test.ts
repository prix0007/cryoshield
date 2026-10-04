/** app-motion-ux D5: createSponsor reports `sponsored` only when the paymaster returned data and `sent` only once
 * the bundler accepted the user operation. */
import { describe, expect, it, vi } from 'vitest';

const order: string[] = [];
let failSend = false;
vi.mock('permissionless/clients/pimlico', () => ({
  createPimlicoClient: () => ({
    request: async () => '0x7a69',
    getPaymasterStubData: async () => ({}),
    getPaymasterData: async () => { order.push('paymaster'); return { paymasterAndData: '0x' }; },
    getUserOperationGasPrice: async () => ({ fast: {} }),
  }),
}));
vi.mock('viem/account-abstraction', async (orig) => ({
  ...(await orig<object>()),
  createBundlerClient: (p: { paymaster: { getPaymasterData: (x: unknown) => Promise<unknown> } }) => ({
    sendUserOperation: async () => {
      await p.paymaster.getPaymasterData({ callData: '0x', sender: '0x' });
      order.push('signed');
      if (failSend) throw new Error('bundler down');
      return '0xabc';
    },
    waitForUserOperationReceipt: async () => ({ success: true, receipt: { transactionHash: '0xdef' } }),
  }),
}));
vi.mock('../../src/account/policy', async (orig) => ({ ...(await orig<object>()), assertSponsorableCalls: () => undefined, assertSponsorableCallData: () => undefined }));
vi.mock('../../src/chain/guard', async (orig) => ({ ...(await orig<object>()), ensureChain: async () => undefined }));

describe('createSponsor progress', () => {
  it('sponsored after paymaster data, sent after the bundler accepted', async () => {
    const { createSponsor } = await import('../../src/account/writes');
    const s = createSponsor({} as never, 'http://bundler.invalid', 'p');
    order.length = 0;
    await s.send({ getAddress: async () => '0x01' } as never, [], (st) => void order.push(st));
    expect(order).toEqual(['paymaster', 'sponsored', 'signed', 'sent']);
  });
  it('sent is not reported when the bundler refuses', async () => {
    const { createSponsor } = await import('../../src/account/writes');
    const s = createSponsor({} as never, 'http://bundler.invalid', 'p');
    order.length = 0;
    failSend = true;
    await expect(s.send({ getAddress: async () => '0x01' } as never, [], (st) => void order.push(st))).rejects.toBeTruthy();
    expect(order).toEqual(['paymaster', 'sponsored', 'signed']);
    failSend = false;
  });
});

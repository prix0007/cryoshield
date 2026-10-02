/** target-op-sepolia review (MEDIUM): verify eth_chainId == VITE_CHAIN_ID before any registry read or account action. */
import { describe, expect, it, vi } from 'vitest';
import { custom } from 'viem';
import { createRegistryReader } from '../../src/chain/registry';
import { ChainMismatchError } from '../../src/chain/guard';
import { unlock } from '../../src/chain/unlock';
import { preflight } from '../../src/account/writes';
import { messageFor } from '../../src/ui/operations';
import { FakeAuthenticators } from '../fixtures/fake-webauthn';
import { enrollKey } from '../../src/webauthn';

function rpc(chainId: number) {
  const calls: string[] = [];
  const transport = custom({
    request: async ({ method }: { method: string }) => {
      calls.push(method);
      if (method === 'eth_chainId') return '0x' + chainId.toString(16);
      if (method === 'eth_call') return '0x' + '00'.repeat(64);
      throw new Error(method);
    },
  });
  return { transport, calls };
}

describe('chain ID guard', () => {
  it('refuses every registry read on a mismatch, before any eth_call', async () => {
    const { transport, calls } = rpc(42161); // config expects 31337
    const r = createRegistryReader(transport);
    await expect(r.resolveLocator(('0x' + '11'.repeat(32)) as `0x${string}`)).rejects.toBeInstanceOf(ChainMismatchError);
    await expect(r.getVault(('0x' + '11'.repeat(32)) as `0x${string}`)).rejects.toBeInstanceOf(ChainMismatchError);
    expect(calls).not.toContain('eth_call');
  });

  it('checks eth_chainId once per session when it matches', async () => {
    const { transport, calls } = rpc(31337);
    const r = createRegistryReader(transport);
    await r.resolveLocator(('0x' + '11'.repeat(32)) as `0x${string}`);
    await r.resolveLocator(('0x' + '22'.repeat(32)) as `0x${string}`);
    expect(calls.filter((c) => c === 'eth_chainId')).toHaveLength(1);
    expect(calls.filter((c) => c === 'eth_call')).toHaveLength(2);
  });

  it('unlock on the wrong chain throws ChainMismatchError, never "no vault"', async () => {
    const f = new FakeAuthenticators();
    f.addKey();
    await enrollKey({ rpId: 'localhost', rpName: 'x', label: 'a', exclude: [] }, f.credentials);
    const { transport } = rpc(10);
    const err = await unlock({ rpId: 'localhost' }, { credentials: f.credentials, reader: createRegistryReader(transport) }).catch((e) => e);
    expect(err).toBeInstanceOf(ChainMismatchError);
    expect(err.expected).toBe(31337);
    expect(err.actual).toBe(10);
  });

  it('write preflight refuses on a mismatch before any call', async () => {
    const client = { getChainId: vi.fn(async () => 11155420), call: vi.fn() } as never;
    await expect(preflight(client, '0x00000000000000000000000000000000000000aa', [])).rejects.toBeInstanceOf(ChainMismatchError);
    expect((client as { call: ReturnType<typeof vi.fn> }).call).not.toHaveBeenCalled();
  });

  it('has a plain-language message', () => {
    expect(messageFor(new ChainMismatchError(31337, 10))).toMatch(/connected to the wrong network/);
  });
});

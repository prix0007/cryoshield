/**
 * web-registry-versions D3: with a v3 configured (the 3-registry fixture: a fake v3 with v2's interface), every write
 * and the sponsor policy target v3 only, and vaults in v2 or v1 are read-only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';

const A3 = '0x00000000000000000000000000000000000000a3' as Hex;
const owner = '0x00000000000000000000000000000000000000aa' as Hex;
const blob = new Uint8Array([1, 2, 3]);

async function withV3() {
  vi.resetModules();
  const base = (await import('../fixtures/virtual-config')).config;
  vi.doMock('virtual:cryoshield-config', () => ({
    config: Object.freeze({ ...base, registries: [{ version: 'v3', abi: 2, address: A3, deployBlock: 12 }, ...base.registries] }),
  }));
  return {
    writes: await import('../../src/account/writes'),
    policy: await import('../../src/account/policy'),
    ops: await import('../../src/ui/operations'),
    cfg: await import('../../src/config'),
  };
}
afterEach(() => {
  vi.doUnmock('virtual:cryoshield-config');
  vi.resetModules();
});

describe('writes go to the newest registry (v3)', () => {
  it('WRITE_REGISTRY is v3', async () => {
    const { cfg } = await withV3();
    expect(cfg.WRITE_REGISTRY).toMatchObject({ version: 'v3', address: A3 });
  });

  it('an update targets v3 only', async () => {
    const { writes } = await withV3();
    const sponsor = { send: vi.fn(async () => ({ userOpHash: '0x01' as Hex, success: true })) };
    const client = { getChainId: async () => 31337, call: vi.fn(async () => ({ data: '0x' })), readContract: vi.fn(async () => 5n) } as never;
    const reader = { getVault: async (vaultId: Hex) => ({ vaultId, owner, blob, version: 2, registry: 'v3' }) } as never;
    await writes.updateVaultOnChain({ account: { getAddress: async () => owner } as never, vaultId: ('0x' + '33'.repeat(32)) as Hex, blob, base: blob }, { client, sponsor, reader });
    const calls = (sponsor.send.mock.calls[0] as unknown as [unknown, { to: Hex }[]])[1];
    expect(calls.map((c) => c.to.toLowerCase())).toEqual([A3]);
  });

  it('the sponsor policy accepts v3 calls and refuses v2 calls', async () => {
    const { policy, cfg } = await withV3();
    const { encodeFunctionData } = await import('viem');
    const { registryV2Abi } = await import('../../src/chain/contracts');
    const data = encodeFunctionData({ abi: registryV2Abi, functionName: 'updateVault', args: [('0x' + '33'.repeat(32)) as Hex, '0x01'] });
    const v2 = cfg.config.registries.find((r: { version: string }) => r.version === 'v2')!.address;
    expect(() => policy.assertSponsorableCalls([{ to: A3, value: 0n, data }], owner)).not.toThrow();
    expect(() => policy.assertSponsorableCalls([{ to: v2, value: 0n, data }], owner)).toThrow();
  });

  it('a vault in v2 or v1 is read-only; a v3 vault is not', async () => {
    const { ops } = await withV3();
    expect(ops.isReadOnly({ registry: 'v3' })).toBe(false);
    expect(ops.isReadOnly({ registry: 'v2' })).toBe(true);
    expect(ops.isReadOnly({ registry: 'v1' })).toBe(true);
  });
});

/** app-motion-ux 2.1 / D5: write-path progress notifications are real events, in order, and can never break a write. */
import { describe, expect, it, vi } from 'vitest';
import { decodeFunctionData, encodeFunctionResult, type Hex } from 'viem';
import { deriveVaultIdV2, registryV2Abi } from '../../src/chain/contracts';
import { addKeyOnChain, createVaultOnChain, updateVaultOnChain, type SaveStage } from '../../src/account/writes';

const owner = '0x00000000000000000000000000000000000000aa' as Hex;
const account = { getAddress: async () => owner } as never;
const blob = new Uint8Array([1, 2, 3]);
/** eth_call: answers VaultRegistry v2 vaultIdFor like the registry; everything else succeeds empty. */
const call = vi.fn(async ({ data }: { data: Hex }) => {
  const d = decodeFunctionData({ abi: registryV2Abi, data });
  if (d.functionName !== 'vaultIdFor') return { data: '0x' };
  const [o, s] = d.args as [Hex, Hex];
  return { data: encodeFunctionResult({ abi: registryV2Abi, functionName: 'vaultIdFor', result: deriveVaultIdV2(o, s) }) };
});
const okClient = { getChainId: async () => 31337, call, readContract: vi.fn(async () => 2n) } as never;
const reader = (b: Uint8Array) => ({ getVault: async (vaultId: Hex) => ({ vaultId, owner, blob: b, version: 2 }) }) as never;
const vaultId = ('0x' + '33'.repeat(32)) as Hex;

/** A sponsor that reports its own real events (paymaster data returned, bundler accepted), like createSponsor. */
const sponsor = () => ({
  send: vi.fn(async (_a: unknown, _c: unknown, onProgress?: (s: SaveStage) => void) => {
    onProgress?.('sponsored');
    onProgress?.('sent');
    return { userOpHash: '0x01' as Hex, success: true };
  }),
});

describe('write progress events (D5)', () => {
  it('create: encrypted -> sponsored -> sent -> confirmed, with onSign between encrypted and sponsored', async () => {
    const log: string[] = [];
    await createVaultOnChain(
      { account, build: async () => ({ blob, locators: [] }) },
      { client: okClient, sponsor: sponsor(), reader: reader(blob), onSign: () => void log.push('sign'), onProgress: (s) => void log.push(s) },
    );
    expect(log).toEqual(['encrypted', 'sign', 'sponsored', 'sent', 'confirmed']);
  });

  it('update and add-key report sponsored -> sent -> confirmed (encrypted is reported by the caller that built the blob)', async () => {
    const a: string[] = [];
    await updateVaultOnChain({ account, vaultId, blob, base: blob }, { client: okClient, sponsor: sponsor(), reader: reader(blob), onProgress: (s) => void a.push(s) });
    expect(a).toEqual(['sponsored', 'sent', 'confirmed']);
    const b: string[] = [];
    await addKeyOnChain(
      { account, vaultId, blob, base: blob, newLocator: ('0x' + '44'.repeat(32)) as Hex, newPublicKey: ('0x' + 'aa'.repeat(64)) as Hex, keyCountBefore: 2 },
      { client: okClient, sponsor: sponsor(), reader: reader(blob), onProgress: (s) => void b.push(s) },
    );
    expect(b).toEqual(['sponsored', 'sent', 'confirmed']);
  });

  it('a throwing progress listener never breaks or alters the write', async () => {
    const r = await updateVaultOnChain(
      { account, vaultId, blob, base: blob },
      { client: okClient, sponsor: sponsor(), reader: reader(blob), onProgress: () => { throw new Error('ui bug'); } },
    );
    expect(r.version).toBe(2);
  });

  it('a throwing listener never breaks create either (and onSign still runs)', async () => {
    const onSign = vi.fn();
    const r = await createVaultOnChain(
      { account, build: async () => ({ blob, locators: [] }) },
      { client: okClient, sponsor: sponsor(), reader: reader(blob), onSign, onProgress: () => { throw new Error('ui bug'); } },
    );
    expect(r.version).toBe(2);
    expect(onSign).toHaveBeenCalledTimes(1);
  });

  it('confirmed is not reported when the read-back differs', async () => {
    const log: string[] = [];
    await expect(
      updateVaultOnChain({ account, vaultId, blob, base: new Uint8Array([9]) }, { client: okClient, sponsor: sponsor(), reader: reader(new Uint8Array([9])), onProgress: (s) => void log.push(s) }),
    ).rejects.toMatchObject({ code: 'NOT_CONFIRMED' });
    expect(log).not.toContain('confirmed');
  });

  it('the listener is never awaited (a never-resolving promise does not stall the write)', async () => {
    const r = await updateVaultOnChain(
      { account, vaultId, blob, base: blob },
      { client: okClient, sponsor: sponsor(), reader: reader(blob), onProgress: (() => new Promise(() => undefined)) as never },
    );
    expect(r.version).toBe(2);
  });
});

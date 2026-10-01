import { describe, expect, it } from 'vitest';
import { createRegistryReader } from '../../src/chain/registry';
import { MockRegistry } from '../fixtures/mock-registry';

const loc = ('0x' + 'aa'.repeat(32)) as `0x${string}`;
const owner = '0x00000000000000000000000000000000000000a1' as const;

describe('registry reads (5.1)', () => {
  it('resolves an unknown locator to an empty list without throwing', async () => {
    const reg = new MockRegistry();
    const r = createRegistryReader(reg.transport());
    expect(await r.resolveLocator(loc)).toEqual([]);
  });

  it('fetches each distinct candidate once and drops empty / oversized blobs', async () => {
    const reg = new MockRegistry();
    reg.put(('0x' + '01'.repeat(32)) as `0x${string}`, { owner, blob: ('0x' + 'ab'.repeat(100)) as `0x${string}`, version: 2 }, [loc]);
    reg.put(('0x' + '02'.repeat(32)) as `0x${string}`, { owner, blob: ('0x' + 'cd'.repeat(1025)) as `0x${string}`, version: 1 }, [loc]);
    reg.index.set(loc, [...reg.index.get(loc)!, ('0x' + '01'.repeat(32)) as `0x${string}`, ('0x' + '03'.repeat(32)) as `0x${string}`]);
    const r = createRegistryReader(reg.transport());
    const c = await r.candidatesFor(loc);
    expect(c.map((x) => x.vaultId)).toEqual(['0x' + '01'.repeat(32)]);
    expect(c[0]!.version).toBe(2);
    expect(c[0]!.blob.length).toBe(100);
    expect(reg.calls.filter((x) => x === 'getVault')).toHaveLength(3);
  });
});

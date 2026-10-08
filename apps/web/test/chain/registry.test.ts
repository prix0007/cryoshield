import { describe, expect, it } from 'vitest';
import { decodeFunctionData, encodeFunctionResult, type Hex } from 'viem';
import { createRegistryReader } from '../../src/chain/registry';
import { MockRegistry } from '../fixtures/mock-registry';

const loc = ('0x' + 'aa'.repeat(32)) as Hex;
const owner = '0x00000000000000000000000000000000000000a1' as const;
const id = (n: number) => (`0x${n.toString(16).padStart(64, '0')}`) as Hex;
const blob = (b: string, n = 100) => (`0x${b.repeat(n)}`) as Hex;

describe('registry reads', () => {
  it('resolves an unknown locator to an empty list in both registries without throwing', async () => {
    const reg = new MockRegistry();
    const r = createRegistryReader(reg.transport());
    expect(await r.candidatesFor(loc)).toEqual([]);
  });

  it('fetches each distinct v2 candidate once, in one getVaults batch', async () => {
    const reg = new MockRegistry();
    reg.put(id(1), { owner, blob: blob('ab'), version: 2 }, [loc]);
    reg.index.set(loc, [...reg.index.get(loc)!, id(1)]);
    const r = createRegistryReader(reg.transport());
    const c = await r.candidatesFor(loc);
    expect(c.map((x) => x.vaultId)).toEqual([id(1)]);
    expect(c[0]).toMatchObject({ version: 2, registry: 'v2' });
    expect(c[0]!.blob.length).toBe(100);
    expect(reg.calls.filter((x) => x === 'getVaults')).toHaveLength(1);
  });

  it('v1 (legacy): drops empty and oversized blobs', async () => {
    const v1 = new MockRegistry('v1');
    v1.put(id(1), { owner, blob: blob('ab'), version: 2 }, [loc]);
    v1.put(id(2), { owner, blob: blob('cd', 1025), version: 1 }, [loc]);
    v1.index.set(loc, [...v1.index.get(loc)!, id(3)]);
    const c = await createRegistryReader(new MockRegistry().transport(v1)).candidatesFor(loc);
    expect(c.map((x) => [x.registry, x.vaultId])).toEqual([['v1', id(1)]]);
  });
});

describe('harden-gas-sponsorship 5.3: v2 pages + getVaults batches, then v1, as one list', () => {
  it('a locator with more than 1,000 entries resolves in 256-entry pages and getVaults batches of at most 32', async () => {
    const reg = new MockRegistry();
    for (let i = 1; i <= 1_030; i++) reg.put(id(i), { owner, blob: blob('00', 1), version: 1 }, [loc]);
    reg.put(id(5_000), { owner, blob: blob('ee'), version: 3 }, [loc]); // the victim's entry, appended last
    const r = createRegistryReader(reg.transport());
    const c = await r.candidatesFor(loc);
    expect(c).toHaveLength(1_031);
    expect(c.at(-1)).toMatchObject({ vaultId: id(5_000), version: 3, registry: 'v2' });
    expect(reg.calls.filter((x) => x === 'resolveLocator')).toHaveLength(Math.ceil(1_031 / 256));
    expect(reg.calls.filter((x) => x === 'getVaults')).toHaveLength(Math.ceil(1_031 / 32));
  });

  it('a v1-only vault is still found (legacy testnet vaults)', async () => {
    const v1 = new MockRegistry('v1');
    v1.put(id(7), { owner, blob: blob('11'), version: 4 }, [loc]);
    const r = createRegistryReader(new MockRegistry().transport(v1));
    const c = await r.candidatesFor(loc);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ vaultId: id(7), version: 4, registry: 'v1' });
  });

  it('candidates from both registries form one list, oldest first (v1 before v2), so unlock shows the newest first', async () => {
    const v1 = new MockRegistry('v1');
    const v2 = new MockRegistry('v2');
    v1.put(id(1), { owner, blob: blob('11'), version: 1 }, [loc]);
    v2.put(id(2), { owner, blob: blob('22'), version: 1 }, [loc]);
    const r = createRegistryReader(v2.transport(v1));
    expect((await r.candidatesFor(loc)).map((c) => [c.registry, c.vaultId])).toEqual([
      ['v1', id(1)],
      ['v2', id(2)],
    ]);
    expect(v2.calls[0]).toBe('locatorLength'); // v2 is queried first
  });

  it('the same vaultId in both registries: v2 is authoritative, the v1 copy is ignored (stale-copy replay)', async () => {
    const v1 = new MockRegistry('v1');
    const v2 = new MockRegistry('v2');
    // v2 holds the current vault; someone registered the same id in v1 with a stale (older, still decryptable) copy.
    v2.put(id(9), { owner, blob: blob('22'), version: 5 }, [loc]);
    v1.put(id(9), { owner: '0x00000000000000000000000000000000000000ee', blob: blob('11'), version: 1 }, [loc]);
    const c = await createRegistryReader(v2.transport(v1)).candidatesFor(loc);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ vaultId: id(9), registry: 'v2', version: 5 });
  });

  it('a v1 entry whose id exists in v2 under ANOTHER locator still yields only the v2 record', async () => {
    const v1 = new MockRegistry('v1');
    const v2 = new MockRegistry('v2');
    const other = ('0x' + 'bb'.repeat(32)) as Hex;
    v2.put(id(9), { owner, blob: blob('22'), version: 5 }, [other]);
    v1.put(id(9), { owner, blob: blob('11'), version: 1 }, [loc]);
    const c = await createRegistryReader(v2.transport(v1)).candidatesFor(loc);
    expect(c.map((x) => [x.registry, x.version])).toEqual([['v2', 5]]);
    expect(v2.calls).toContain('getVaults'); // the v1 id was checked against v2
  });

  it('when v2 cannot be confirmed (RPC error), it never falls back to v1: RegistryUnconfirmedError', async () => {
    const { RegistryUnconfirmedError } = await import('../../src/chain/registry');
    const v1 = new MockRegistry('v1');
    const v2 = new MockRegistry('v2');
    v1.put(id(9), { owner, blob: blob('11'), version: 1 }, [loc]);
    v2.handle = () => {
      throw new Error('rpc down');
    };
    await expect(createRegistryReader(v2.transport(v1)).candidatesFor(loc)).rejects.toBeInstanceOf(RegistryUnconfirmedError);
  });

  it('when v2 disagrees with itself (a listed id has no record), it is unconfirmed, not a v1 fallback', async () => {
    const { RegistryUnconfirmedError } = await import('../../src/chain/registry');
    const v1 = new MockRegistry('v1');
    const v2 = new MockRegistry('v2');
    v1.put(id(9), { owner, blob: blob('11'), version: 1 }, [loc]);
    v2.index.set(loc, [id(9)]); // listed under the locator, but getVaults returns an empty record
    await expect(createRegistryReader(v2.transport(v1)).candidatesFor(loc)).rejects.toBeInstanceOf(RegistryUnconfirmedError);
  });

  it('getVault reads the registry the vault lives in', async () => {
    const v1 = new MockRegistry('v1');
    const v2 = new MockRegistry('v2');
    v1.put(id(1), { owner, blob: blob('11'), version: 5 }, [loc]);
    v2.put(id(1), { owner, blob: blob('22'), version: 6 }, [loc]);
    const r = createRegistryReader(v2.transport(v1));
    expect((await r.getVault(id(1)))?.version).toBe(6);
    expect((await r.getVault(id(1), 'v1'))?.version).toBe(5);
  });
});

describe('web-registry-versions D2: the newest registry holding a vault ID is authoritative (v3 > v2 > v1)', () => {
  // The 3-registry fixture: a fake v3 with v2's interface, next to the configured v2 and v1.
  const A3 = '0x00000000000000000000000000000000000000a3' as const;
  const setup = () => {
    const v3 = new MockRegistry('v3', { abi: 2, address: A3 });
    const v2 = new MockRegistry('v2');
    const v1 = new MockRegistry('v1');
    const reader = createRegistryReader(v3.transport(v2, v1), [v3.config, v2.config, v1.config]);
    return { v3, v2, v1, reader };
  };
  const brief = (c: { registry: string; vaultId: Hex; version: number }[]) => c.map((x) => [x.registry, x.vaultId, x.version]);

  it('one id in all three registries: only v3\'s copy, whichever registry lists it', async () => {
    const { v3, v2, v1, reader } = setup();
    v3.put(id(9), { owner, blob: blob('33'), version: 7 }, [loc]);
    v2.put(id(9), { owner, blob: blob('22'), version: 5 }, [loc]);
    v1.put(id(9), { owner, blob: blob('11'), version: 1 }, [loc]);
    expect(brief(await reader.candidatesFor(loc))).toEqual([['v3', id(9), 7]]);
    expect(v3.calls[0]).toBe('locatorLength'); // the newest registry is queried first
  });

  it('a v1 id and a v2 id held by v3 under ANOTHER locator yield only v3\'s records', async () => {
    const { v3, v2, v1, reader } = setup();
    const other = ('0x' + 'bb'.repeat(32)) as Hex;
    v3.put(id(1), { owner, blob: blob('33'), version: 4 }, [other]);
    v3.put(id(2), { owner, blob: blob('34'), version: 6 }, [other]);
    v2.put(id(2), { owner, blob: blob('22'), version: 5 }, [loc]);
    v1.put(id(1), { owner, blob: blob('11'), version: 1 }, [loc]);
    const c = brief(await reader.candidatesFor(loc));
    expect(c).toHaveLength(2);
    expect(c).toEqual(expect.arrayContaining([['v3', id(1), 4], ['v3', id(2), 6]]));
  });

  it('a v1 id held by v2 (not v3) yields v2\'s copy; v3 was checked first', async () => {
    const { v3, v2, v1, reader } = setup();
    v2.put(id(5), { owner, blob: blob('22'), version: 3 }, [('0x' + 'cc'.repeat(32)) as Hex]);
    v1.put(id(5), { owner, blob: blob('11'), version: 1 }, [loc]);
    expect(brief(await reader.candidatesFor(loc))).toEqual([['v2', id(5), 3]]);
    expect(v3.calls.filter((x) => x === 'getVaults').length).toBeGreaterThan(0);
  });

  it('distinct vaults in each registry form one list, oldest first (unlock shows the newest first)', async () => {
    const { v3, v2, v1, reader } = setup();
    v3.put(id(3), { owner, blob: blob('33'), version: 1 }, [loc]);
    v2.put(id(2), { owner, blob: blob('22'), version: 1 }, [loc]);
    v1.put(id(1), { owner, blob: blob('11'), version: 1 }, [loc]);
    expect((await reader.candidatesFor(loc)).map((c) => c.registry)).toEqual(['v1', 'v2', 'v3']);
  });

  it('a v1-only vault still opens when v3 and v2 both confirm they lack it', async () => {
    const { v1, reader } = setup();
    v1.put(id(7), { owner, blob: blob('11'), version: 4 }, [loc]);
    expect(brief(await reader.candidatesFor(loc))).toEqual([['v1', id(7), 4]]);
  });

  it('v3 unconfirmed (RPC error): no fallback to v2 or v1 (RegistryUnconfirmedError)', async () => {
    const { RegistryUnconfirmedError } = await import('../../src/chain/registry');
    const { v3, v2, v1, reader } = setup();
    v2.put(id(9), { owner, blob: blob('22'), version: 5 }, [loc]);
    v1.put(id(8), { owner, blob: blob('11'), version: 1 }, [loc]);
    v3.handle = () => {
      throw new Error('rpc down');
    };
    await expect(reader.candidatesFor(loc)).rejects.toBeInstanceOf(RegistryUnconfirmedError);
  });

  it('v3 fails only when asked about an older id: still unconfirmed, never v1\'s copy', async () => {
    const { RegistryUnconfirmedError } = await import('../../src/chain/registry');
    const { v3, v1, reader } = setup();
    v1.put(id(8), { owner, blob: blob('11'), version: 1 }, [loc]);
    const real = v3.handle.bind(v3);
    v3.handle = (data) => {
      if (decodeFunctionData({ abi: v3.abi, data }).functionName === 'getVaults') throw new Error('rpc down');
      return real(data);
    };
    await expect(reader.candidatesFor(loc)).rejects.toBeInstanceOf(RegistryUnconfirmedError);
  });

  it('v2 unconfirmed while v3 is fine: an id only v1 lists is not shown', async () => {
    const { RegistryUnconfirmedError } = await import('../../src/chain/registry');
    const { v2, v1, reader } = setup();
    v1.put(id(8), { owner, blob: blob('11'), version: 1 }, [loc]);
    v2.handle = () => {
      throw new Error('rpc down');
    };
    await expect(reader.candidatesFor(loc)).rejects.toBeInstanceOf(RegistryUnconfirmedError);
  });

  it('an id in v2 and v1 but not in v3: v2\'s copy only', async () => {
    const { v2, v1, reader } = setup();
    v2.put(id(4), { owner, blob: blob('22'), version: 3 }, [loc]);
    v1.put(id(4), { owner, blob: blob('11'), version: 1 }, [loc]);
    expect(brief(await reader.candidatesFor(loc))).toEqual([['v2', id(4), 3]]);
  });

  it('a malformed record in a newer registry (owner set, empty blob) is unconfirmed, never the older copy', async () => {
    const { RegistryUnconfirmedError } = await import('../../src/chain/registry');
    const { v3, v1, reader } = setup();
    v3.put(id(6), { owner, blob: '0x', version: 2 }, [('0x' + 'dd'.repeat(32)) as Hex]);
    v1.put(id(6), { owner, blob: blob('11'), version: 1 }, [loc]);
    await expect(reader.candidatesFor(loc)).rejects.toBeInstanceOf(RegistryUnconfirmedError);
  });

  it('a getVaults row-count mismatch in a newer registry is unconfirmed', async () => {
    const { RegistryUnconfirmedError } = await import('../../src/chain/registry');
    const { v3, v1, reader } = setup();
    v1.put(id(6), { owner, blob: blob('11'), version: 1 }, [loc]);
    const real = v3.handle.bind(v3);
    v3.handle = (data) => {
      const d = decodeFunctionData({ abi: v3.abi, data });
      if (d.functionName !== 'getVaults') return real(data);
      return encodeFunctionResult({ abi: v3.abi, functionName: 'getVaults', result: [] } as never);
    };
    await expect(reader.candidatesFor(loc)).rejects.toBeInstanceOf(RegistryUnconfirmedError);
  });

  it('more than 32 ids across registries: newer registries are asked in getVaults batches of at most 32', async () => {
    const { v3, v2, v1, reader } = setup();
    for (let i = 1; i <= 40; i++) v2.put(id(i), { owner, blob: blob('22'), version: 1 }, [loc]);
    for (let i = 41; i <= 56; i++) v1.put(id(i), { owner, blob: blob('11'), version: 1 }, [loc]);
    v3.put(id(40), { owner, blob: blob('33'), version: 9 }, [('0x' + 'ee'.repeat(32)) as Hex]); // the 40th: in the 2nd batch
    const c = await reader.candidatesFor(loc);
    expect(c).toHaveLength(56);
    expect(c.filter((x) => x.registry === 'v3').map((x) => [x.vaultId, x.version])).toEqual([[id(40), 9]]);
    // v3 is asked about v2's 40 ids in 2 batches and about v1's 16 in 1.
    expect(v3.calls.filter((x) => x === 'getVaults')).toHaveLength(3);
  });

  it('a middle registry with the v1 interface: it is asked with getVault, and its copy beats the oldest', async () => {
    const A2b = '0x00000000000000000000000000000000000000b2' as Hex;
    const v3 = new MockRegistry('v3', { abi: 2, address: A3 });
    const mid = new MockRegistry('v2', { abi: 1, address: A2b });
    const v1 = new MockRegistry('v1');
    const reader = createRegistryReader(v3.transport(mid, v1), [v3.config, mid.config, v1.config]);
    mid.put(id(2), { owner, blob: blob('22'), version: 2 }, [loc]);
    mid.put(id(3), { owner, blob: blob('23'), version: 5 }, [('0x' + 'ab'.repeat(32)) as Hex]);
    v1.put(id(3), { owner, blob: blob('11'), version: 1 }, [loc]);
    expect(brief(await reader.candidatesFor(loc))).toEqual(expect.arrayContaining([['v2', id(2), 2], ['v2', id(3), 5]]));
    expect((await reader.candidatesFor(loc)).some((c) => c.registry === 'v1')).toBe(false);
    expect(mid.calls).toContain('getVault');
    expect(mid.calls).not.toContain('getVaults');
  });

  it('getVault, locatorsOf and vaultOf default to the newest registry; getVault takes any version', async () => {
    const { v3, v2, reader } = setup();
    v3.put(id(1), { owner, blob: blob('33'), version: 8 }, [loc]);
    v2.put(id(1), { owner, blob: blob('22'), version: 6 }, [loc]);
    expect((await reader.getVault(id(1)))).toMatchObject({ registry: 'v3', version: 8 });
    expect((await reader.getVault(id(1), 'v2'))).toMatchObject({ registry: 'v2', version: 6 });
    await expect(reader.getVault(id(1), 'v9')).rejects.toThrow(/v9/);
  });
});

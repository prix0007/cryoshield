import { describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
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

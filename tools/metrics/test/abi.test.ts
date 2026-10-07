// The tool's minimal ABIs must match the committed registry ABIs (every version shares the event layout).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toEventSelector, toFunctionSelector, type AbiEvent, type AbiFunction } from 'viem';
import { describe, expect, it } from 'vitest';
import { REGISTRY_ABI, REGISTRY_EVENTS, TOPIC } from '../src/abi.ts';
import { REPO_ROOT } from '../src/config.ts';

const committed = (f: string) => {
  const doc = JSON.parse(readFileSync(join(REPO_ROOT, 'contracts/abi', f), 'utf8'));
  return (Array.isArray(doc) ? doc : doc.abi) as (AbiEvent | AbiFunction)[];
};

describe('ABIs', () => {
  for (const file of ['VaultRegistry.json', 'VaultRegistryV2.json']) {
    it(`${file}: the three events have the tool's topics`, () => {
      const events = committed(file).filter((x): x is AbiEvent => x.type === 'event');
      for (const name of ['VaultCreated', 'VaultUpdated', 'LocatorAdded'] as const) {
        const ev = events.find((e) => e.name === name);
        expect(ev && toEventSelector(ev)).toBe(TOPIC[name]);
      }
      expect(REGISTRY_EVENTS).toHaveLength(3);
    });
  }

  it('getVault (v1, v2) and getVaults (v2) selectors match', () => {
    const fn = (abi: (AbiEvent | AbiFunction)[], name: string) => abi.find((x): x is AbiFunction => x.type === 'function' && x.name === name);
    const mine = (name: string) => fn(REGISTRY_ABI as unknown as AbiFunction[], name) as AbiFunction;
    const v1 = committed('VaultRegistry.json');
    const v2 = committed('VaultRegistryV2.json');
    expect(toFunctionSelector(mine('getVault'))).toBe(toFunctionSelector(fn(v1, 'getVault') as AbiFunction));
    expect(toFunctionSelector(mine('getVault'))).toBe(toFunctionSelector(fn(v2, 'getVault') as AbiFunction));
    expect(toFunctionSelector(mine('getVaults'))).toBe(toFunctionSelector(fn(v2, 'getVaults') as AbiFunction));
  });
});

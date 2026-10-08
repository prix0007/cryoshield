// The spec's known fixture (product-metrics "Known fixture"): 3 vaults with 2, 2 and 3 keys, one updated twice in week
// W = 2026-W41, across BOTH registry versions; plus one locator added in 2026-W42 and EntryPoint operations for the
// sponsored-gas metric. All addresses and ids are synthetic.
import { keccak256, toHex, type Hex } from 'viem';
import type { Network } from '../../src/config.ts';
import { fixtureBlob } from './blobs.ts';
import { FakeChain } from './chain.ts';

export const RPC = 'https://rpc.example';
export const REG1: Hex = '0x00000000000000000000000000000000000000a1';
export const REG2: Hex = '0x00000000000000000000000000000000000000a2';
export const ENTRY_POINT: Hex = '0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789';
export const SPONSOR: Hex = '0x6666666666667849c56f2850848ce1c4da65c68b';
export const OTHER_PAYMASTER: Hex = '0x00000000000000000000000000000000000000f0';
export const ZERO: Hex = '0x0000000000000000000000000000000000000000';

export const OWNER = {
  a: '0x000000000000000000000000000000000000000a' as Hex,
  b: '0x000000000000000000000000000000000000000b' as Hex,
  c: '0x000000000000000000000000000000000000000c' as Hex,
  stranger: '0x00000000000000000000000000000000000000ee' as Hex,
};
export const VAULT = {
  a: keccak256(toHex('vault-a')),
  b: keccak256(toHex('vault-b')),
  c: keccak256(toHex('vault-c')),
};
const loc = (s: string) => keccak256(toHex(`locator-${s}`));

export const W41 = '2026-W41';
export const W42 = '2026-W42';
const MON_W41 = Date.UTC(2026, 9, 5, 12) / 1000; // Monday 2026-10-05 12:00 UTC
const DAY = 86_400;

export interface Scenario {
  chain: FakeChain;
  blobs: Record<'a' | 'b' | 'c', Uint8Array>; // latest blob per vault
}

export function scenario(chainId = 31337): Scenario {
  const chain = new FakeChain(chainId);
  const a = fixtureBlob(2, { seed: 1 });
  const b = fixtureBlob(2, { seed: 2 });
  const c1 = fixtureBlob(3, { seed: 3 });
  const c2 = fixtureBlob(3, { seed: 4 });
  const c3 = fixtureBlob(3, { seed: 5 });
  chain.create(REG1, { vaultId: VAULT.a, owner: OWNER.a, blob: a, block: 10n, ts: MON_W41, locators: [loc('a1'), loc('a2')] });
  chain.create(REG2, { vaultId: VAULT.b, owner: OWNER.b, blob: b, block: 20n, ts: MON_W41 + DAY, locators: [loc('b1'), loc('b2')] });
  chain.create(REG2, { vaultId: VAULT.c, owner: OWNER.c, blob: c1, block: 30n, ts: MON_W41 + 2 * DAY, locators: [loc('c1'), loc('c2')] });
  chain.update(REG2, { vaultId: VAULT.c, blob: c2, block: 40n, ts: MON_W41 + 3 * DAY });
  chain.update(REG2, { vaultId: VAULT.c, blob: c3, block: 50n, ts: MON_W41 + 4 * DAY });
  chain.addLocator(REG1, { vaultId: VAULT.a, locator: loc('a3'), block: 60n, ts: MON_W41 + 7 * DAY });

  // EntryPoint v0.6 operations: two sponsored vault operations (counted), one unsponsored and one through another
  // paymaster (both excluded from the sponsored total), and a sponsored op by a non-vault account (excluded).
  chain.userOp(ENTRY_POINT, { sender: OWNER.b, paymaster: SPONSOR, gasCost: 1_000_000_000_000_000n, block: 20n, ts: MON_W41 + DAY });
  chain.userOp(ENTRY_POINT, { sender: OWNER.c, paymaster: SPONSOR, gasCost: 2_000_000_000_000_000n, block: 30n, ts: MON_W41 + 2 * DAY });
  chain.userOp(ENTRY_POINT, { sender: OWNER.c, paymaster: ZERO, gasCost: 5_000_000_000_000_000n, block: 40n, ts: MON_W41 + 3 * DAY });
  chain.userOp(ENTRY_POINT, { sender: OWNER.a, paymaster: OTHER_PAYMASTER, gasCost: 7_000_000_000_000_000n, block: 60n, ts: MON_W41 + 7 * DAY });
  chain.userOp(ENTRY_POINT, { sender: OWNER.stranger, paymaster: SPONSOR, gasCost: 9_000_000_000_000_000n, block: 61n, ts: MON_W41 + 7 * DAY });
  chain.head = 70n;
  chain.timestamps.set(70n, MON_W41 + 9 * DAY); // the head is in W42 (Wednesday): W42 is not complete
  return { chain, blobs: { a, b: b, c: c3 } };
}

export function network(chainId = 31337): Network {
  return {
    name: chainId === 31337 ? 'anvil' : 'op-sepolia',
    chainId,
    public: chainId !== 31337,
    rpcs: [RPC],
    registries: [
      { version: 2, address: REG2, deployBlock: 15n, abi: 2 },
      { version: 1, address: REG1, deployBlock: 5n, abi: 1 },
    ],
  };
}

export const GAS = { entryPoint: ENTRY_POINT, paymasters: [SPONSOR] };

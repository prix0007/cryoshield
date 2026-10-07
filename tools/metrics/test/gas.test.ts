// Task 1.5: sponsored gas = sum of UserOperationEvent.actualGasCost where sender is a vault owner and paymaster is a
// configured sponsor (spec "Unsponsored operation excluded").
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { collect } from '../src/metrics.ts';
import { loadPaymasters } from '../src/config.ts';
import { GAS, network, RPC, scenario, W41 } from './fixtures/scenario.ts';

describe('sponsored gas', () => {
  it('sums only sponsored operations by vault owners, in wei and ETH, per week', async () => {
    const { chain } = scenario();
    const r = await collect(network(), { fetchFn: chain.fetchFor([RPC]), mirror: false, gas: GAS });
    expect(r.sponsored_gas).toEqual({
      ops: 2,
      total_wei: '3000000000000000',
      total_eth: '0.003',
      per_week: { [W41]: { ops: 2, wei: '3000000000000000', eth: '0.003' } },
      pending: 0,
      excluded: { unsponsored_ops: 1, other_paymaster_ops: 1 },
      paymasters_configured: 1,
    });
  });

  it('queries the EntryPoint only by vault-owner sender topics (never every operation on the chain)', async () => {
    const { chain } = scenario();
    await collect(network(), { fetchFn: chain.fetchFor([RPC]), mirror: false, gas: GAS });
    const ep = chain.requests
      .filter((q) => q.method === 'eth_getLogs')
      .map((q) => q.params[0] as { address: string; topics: (string | string[] | null)[] })
      .filter((f) => f.address === GAS.entryPoint);
    expect(ep.length).toBeGreaterThan(0);
    for (const f of ep) expect(Array.isArray(f.topics[2]) && f.topics[2].length > 0).toBe(true);
  });

  it('is null when no sponsor paymaster is configured for the network', async () => {
    const { chain } = scenario();
    const r = await collect(network(), { fetchFn: chain.fetchFor([RPC]), mirror: false, gas: false });
    expect(r.sponsored_gas).toBeNull();
  });

  it('paymasters.json records the OP Sepolia sponsor paymaster with a source URL', () => {
    const p = loadPaymasters('op-sepolia');
    expect(p?.entryPoint).toBe('0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789');
    expect(p?.paymasters).toContain('0x6666666666667849c56f2850848ce1c4da65c68b');
    const raw = JSON.parse(readFileSync(new URL('../paymasters.json', import.meta.url), 'utf8'));
    for (const pm of raw.networks['op-sepolia'].sponsors) expect(pm.source).toMatch(/^https:\/\//);
    expect(loadPaymasters('op-mainnet')).toBeNull();
  });
});

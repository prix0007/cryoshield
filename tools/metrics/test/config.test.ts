// Task 1.1/1.2: presets from config/chain-presets.json; every registry version from contracts/deployments/<chainId>.json.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadNetwork, loadPresets, parseDeployment, REPO_ROOT, RPCS } from '../src/config.ts';

const V1_ABI = '0x978e16a51813cacf2f723f72db77d1e10c186e489ccf4cca8ec8bb4517cd0a07';
const V2_ABI = '0xacb135ccf895846a59981b20545041660e21942c6108c000d9f1c46f552cb95c';
const A1 = '0x1111111111111111111111111111111111111111';
const A2 = '0x2222222222222222222222222222222222222222';
const A3 = '0x3333333333333333333333333333333333333333';

describe('parseDeployment', () => {
  it('reads v1 (top-level), contracts.vaultRegistryV2 and contracts.vaultRegistries.vN, newest first', () => {
    const r = parseDeployment({
      chainId: 11155420,
      address: A1,
      deployBlock: 10,
      abiHash: V1_ABI,
      contracts: {
        vaultRegistryV2: { address: A2, deployBlock: 20, abiHash: V2_ABI },
        vaultRegistries: { v3: { address: A3, deployBlock: 30, abiHash: V2_ABI } },
        wallets: { 'cryoshield.app': { factory: A1 } },
      },
    });
    expect(r.chainId).toBe(11155420);
    expect(r.registries.map((x) => [x.version, x.address, x.deployBlock, x.abi])).toEqual([
      [3, A3, 30n, 2],
      [2, A2, 20n, 2],
      [1, A1, 10n, 1],
    ]);
  });

  it('refuses a version whose read ABI is unknown (no abiHash match), never guessing', () => {
    expect(() =>
      parseDeployment({ chainId: 1, contracts: { vaultRegistries: { v4: { address: A3, deployBlock: 1, abiHash: `0x${'ab'.repeat(32)}` } } } }),
    ).toThrow(ConfigError);
  });

  it('refuses bad addresses, the zero address, duplicates and an empty record', () => {
    expect(() => parseDeployment({ chainId: 1, address: '0x1234' })).toThrow(ConfigError);
    expect(() => parseDeployment({ chainId: 1, address: `0x${'0'.repeat(40)}` })).toThrow(ConfigError);
    expect(() => parseDeployment({ chainId: 1, address: A1, contracts: { vaultRegistryV2: { address: A1, deployBlock: 1 } } })).toThrow(/twice/);
    expect(() => parseDeployment({ chainId: 1, contracts: {} })).toThrow(/no VaultRegistry/);
  });

  it('reads every registry in the committed OP Sepolia record', () => {
    const doc = JSON.parse(readFileSync(join(REPO_ROOT, 'contracts/deployments/11155420.json'), 'utf8'));
    const r = parseDeployment(doc);
    expect(r.registries.map((x) => x.version)).toEqual([2, 1]);
    expect(r.registries[1]?.address).toBe(doc.address.toLowerCase());
    expect(r.registries[0]?.address).toBe(doc.contracts.vaultRegistryV2.address.toLowerCase());
  });
});

describe('presets', () => {
  it('every RPC preset is a chain preset with the same name (config/chain-presets.json)', () => {
    const presets = loadPresets();
    for (const name of Object.keys(RPCS)) expect(presets.map((p) => p.name)).toContain(name);
    for (const p of presets) expect(RPCS[p.name]?.length ?? 0).toBeGreaterThan(0);
  });

  it('loads op-sepolia with its registries and public RPCs only (https)', () => {
    const n = loadNetwork('op-sepolia');
    expect(n.chainId).toBe(11155420);
    expect(n.public).toBe(true);
    expect(n.registries.length).toBeGreaterThanOrEqual(2);
    for (const u of n.rpcs) expect(u).toMatch(/^https:\/\//);
  });

  it('anvil is not public (no small-cell suppression)', () => {
    expect(loadNetwork('anvil').public).toBe(false);
  });

  it('a network without a deployment record is refused, an unknown name too', () => {
    expect(() => loadNetwork('op-mainnet')).toThrow(/no VaultRegistry deployment/);
    expect(() => loadNetwork('nope')).toThrow(/unknown network/);
  });

  it('a deployment file override must be for the same chain', () => {
    const dir = mkdtempSync(join(tmpdir(), 'metrics-'));
    const f = join(dir, 'd.json');
    writeFileSync(f, JSON.stringify({ chainId: 10, address: A1, deployBlock: 1 }));
    expect(() => loadNetwork('anvil', { deploymentFile: f })).toThrow(/chain 10/);
    writeFileSync(f, JSON.stringify({ chainId: 31337, contracts: { vaultRegistryV2: { address: A2, deployBlock: 5 } } }));
    expect(loadNetwork('anvil', { deploymentFile: f }).registries.map((r) => r.address)).toEqual([A2]);
  });

  it('--rpc overrides must be http(s) URLs', () => {
    expect(() => loadNetwork('anvil', { rpcs: ['file:///etc/passwd'] })).toThrow(ConfigError);
    expect(loadNetwork('anvil', { rpcs: ['http://127.0.0.1:9999'] }).rpcs).toEqual(['http://127.0.0.1:9999']);
  });
});

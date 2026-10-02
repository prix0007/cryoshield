// @vitest-environment node
/** target-op-sepolia tasks 3.1, 3.2, 3.5 (web). */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { keccak256, toHex } from 'viem';
import { parseEnv } from '../../src/config/schema';
import { loadDeployment } from '../../vite-plugins/deployment';
import { cryoshield } from '../../vite-plugins/cryoshield';

const web = join(__dirname, '..', '..');
const presets = JSON.parse(readFileSync(join(web, '../../config/chain-presets.json'), 'utf8')) as {
  presets: { name: string; chainId: number }[];
  defaultTestnet: string;
};
const exampleText = readFileSync(join(web, '.env.example'), 'utf8');
const example = Object.fromEntries(
  exampleText
    .split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);

function contractsWithoutOpSepolia() {
  const dir = mkdtempSync(join(tmpdir(), 'cs-op-'));
  mkdirSync(join(dir, 'abi'));
  mkdirSync(join(dir, 'deployments'));
  writeFileSync(join(dir, 'abi', 'VaultRegistry.json'), '[]');
  return dir;
}

describe('3.1 build for a chain without a deployment record', () => {
  it('fails naming contracts/deployments/11155420.json (loader and plugin)', () => {
    const dir = contractsWithoutOpSepolia();
    expect(() => loadDeployment(dir, 11155420)).toThrow(join('deployments', '11155420.json'));
    expect(() => cryoshield({ ...example, VITE_CHAIN_ID: '11155420' }, dir)).toThrow(join('deployments', '11155420.json'));
  });
});

describe('3.2 .env.example targets OP Sepolia', () => {
  it('parses with the config schema and names the OP Sepolia RPC and Pimlico endpoint', () => {
    const c = parseEnv(example);
    expect(c.chainId).toBe(11155420);
    expect(c.rpcUrl).toBe('https://sepolia.optimism.io');
    expect(c.bundlerUrl).toBe('https://api.pimlico.io/v2/optimism-sepolia/rpc?apikey=pim_REPLACE_ME');
  });
});

describe('3.5 preset parity: chain IDs documented in .env.example == presets.json', () => {
  it('lists exactly the preset chain IDs, and the example uses the default testnet', () => {
    const comment = exampleText.split('\n').find((l) => l.includes('VITE_CHAIN_ID') === false && /\d+ = /.test(l)) ?? '';
    const documented = [...exampleText.matchAll(/(\d+) = ([a-z0-9-]+)/g)].map((m) => ({ chainId: Number(m[1]), name: m[2] }));
    expect(comment).not.toBe('');
    expect(documented.sort((a, b) => a.chainId - b.chainId)).toEqual(
      presets.presets.map((p) => ({ chainId: p.chainId, name: p.name })).sort((a, b) => a.chainId - b.chainId),
    );
    const testnet = presets.presets.find((p) => p.name === presets.defaultTestnet)!;
    expect(Number(example.VITE_CHAIN_ID)).toBe(testnet.chainId);
  });
});

describe('every preset chain builds when its deployment record exists (Arbitrum stays configurable)', () => {
  it.each(presets.presets.map((p) => p.chainId))('chain %i', (chainId) => {
    const dir = contractsWithoutOpSepolia();
    const abi = readFileSync(join(dir, 'abi', 'VaultRegistry.json'));

    writeFileSync(
      join(dir, 'deployments', `${chainId}.json`),
      JSON.stringify({ chainId, address: '0xB43f58cF17e64B603aE5588a1DD17E96a0849e44', deployBlock: 1, txHash: '0x', abiHash: keccak256(toHex(new Uint8Array(abi))) }),
    );
    const env = { ...example, VITE_CHAIN_ID: String(chainId), VITE_RPC_URL: 'https://rpc.example' };
    const plugin = cryoshield(env, dir) as { load: (id: string) => string };
    expect(plugin.load('\0virtual:cryoshield-config')).toContain(`"chainId":${chainId}`);
  });
});

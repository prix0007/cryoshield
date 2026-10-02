import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keccak256, toHex } from 'viem';
import { describe, expect, it } from 'vitest';
import { loadDeployment } from '../../vite-plugins/deployment';

function fixture(record: object | null, abi = '[{"type":"function","name":"x","inputs":[],"outputs":[]}]') {
  const dir = mkdtempSync(join(tmpdir(), 'cs-dep-'));
  mkdirSync(join(dir, 'abi'));
  mkdirSync(join(dir, 'deployments'));
  writeFileSync(join(dir, 'abi', 'VaultRegistry.json'), abi);
  if (record) writeFileSync(join(dir, 'deployments', '31337.json'), JSON.stringify(record));
  return { dir, abiHash: keccak256(toHex(new TextEncoder().encode(abi))) };
}

describe('loadDeployment', () => {
  it('reads address and deployBlock when the abiHash matches', () => {
    const { dir, abiHash } = fixture(null);
    writeFileSync(
      join(dir, 'deployments', '31337.json'),
      JSON.stringify({ chainId: 31337, address: '0xB43f58cF17e64B603aE5588a1DD17E96a0849e44', deployBlock: 1, txHash: '0x' + '11'.repeat(32), abiHash }),
    );
    const d = loadDeployment(dir, 31337);
    expect(d.address).toBe('0xB43f58cF17e64B603aE5588a1DD17E96a0849e44');
    expect(d.deployBlock).toBe(1);
    expect(d.abi).toHaveLength(1);
  });

  it('fails naming the expected path when the chain has no deployment file', () => {
    const { dir } = fixture(null);
    expect(() => loadDeployment(dir, 421614)).toThrow(join('deployments', '421614.json'));
  });

  it('fails naming both hashes on ABI drift', () => {
    const wrong = '0x' + 'ab'.repeat(32);
    const { dir, abiHash } = fixture({ chainId: 31337, address: '0xB43f58cF17e64B603aE5588a1DD17E96a0849e44', deployBlock: 1, txHash: '0x' + '11'.repeat(32), abiHash: wrong });
    expect(() => loadDeployment(dir, 31337)).toThrow(new RegExp(`${wrong}.*${abiHash}|${abiHash}.*${wrong}`));
  });

  it('fails on a chainId mismatch or a malformed address', () => {
    const { dir, abiHash } = fixture(null);
    writeFileSync(join(dir, 'deployments', '31337.json'), JSON.stringify({ chainId: 1, address: '0xB43f58cF17e64B603aE5588a1DD17E96a0849e44', deployBlock: 1, txHash: '0x', abiHash }));
    expect(() => loadDeployment(dir, 31337)).toThrow(/chainId/);
    writeFileSync(join(dir, 'deployments', '31337.json'), JSON.stringify({ chainId: 31337, address: '0x1234', deployBlock: 1, txHash: '0x', abiHash }));
    expect(() => loadDeployment(dir, 31337)).toThrow(/address/);
  });

  it('accepts the real contracts/deployments/31337.json', () => {
    const d = loadDeployment(join(__dirname, '../../../../contracts'), 31337);
    expect(d.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});

// @vitest-environment node
/** target-op-sepolia 3.3 / design D4: fixtures come from OP Sepolia and are byte-identical to the Arbitrum Sepolia copies. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { keccak256 } from 'viem';
import { describe, expect, it } from 'vitest';

const dir = join(__dirname, '..', '..', 'e2e', 'fixtures');
const current = JSON.parse(readFileSync(join(dir, 'chain-fixtures.json'), 'utf8'));
const arbitrum = JSON.parse(readFileSync(join(dir, 'chain-fixtures.arbitrum-sepolia.json'), 'utf8'));
const CONTRACTS = ['entryPoint06', 'senderCreator06', 'cbswFactory11', 'cbswImplementation11'] as const;

describe('E2E chain fixtures', () => {
  it('are sourced from OP Sepolia (chain 11155420)', () => {
    expect(current.sourceChainId).toBe(11155420);
    expect(current.source).toBe('https://sepolia.optimism.io');
  });

  it.each(CONTRACTS)('%s: same address and byte-identical code as the Arbitrum Sepolia fixture', (k) => {
    expect(current[k].address.toLowerCase()).toBe(arbitrum[k].address.toLowerCase());
    expect(current[k].code).toBe(arbitrum[k].code);
    expect(keccak256(current[k].code)).toBe(current[k].codeHash);
  });
});

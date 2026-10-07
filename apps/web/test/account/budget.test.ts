/** D8/D10: the raw nonce read used when a vault opens matches viem's EntryPoint encoding. */
import { describe, expect, it, vi } from 'vitest';
import { encodeFunctionData, getAddress, parseAbi } from 'viem';
import { entryPoint06Address } from 'viem/account-abstraction';
import { ENTRY_POINT_06, readNonce } from '../../src/account/budget';

describe('readNonce', () => {
  it('is EntryPoint v0.6 getNonce(owner, 0), decoded as a bigint', async () => {
    const owner = getAddress('0x00000000000000000000000000000000000000aa');
    const request = vi.fn(async () => '0x2b');
    expect(await readNonce({ request }, owner)).toBe(43n);
    expect(getAddress(ENTRY_POINT_06)).toBe(getAddress(entryPoint06Address));
    const want = encodeFunctionData({ abi: parseAbi(['function getNonce(address sender, uint192 key) view returns (uint256)']), functionName: 'getNonce', args: [owner, 0n] });
    expect(request).toHaveBeenCalledWith({ method: 'eth_call', params: [{ to: ENTRY_POINT_06, data: want }, 'latest'] });
  });
});

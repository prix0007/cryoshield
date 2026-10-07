/**
 * Testnet save-budget hint (vault-list-labels-archive D10). Pimlico sponsors at most 50 operations per sender for its
 * lifetime on testnet (harden-gas-sponsorship D2); the EntryPoint nonce counts the included ones. "About": failed
 * operations may count differently. Pure, so it stays in the initial chunk; the nonce read is in the write stack.
 */
export const SPONSOR_CAP = 50;
/** Shown only at or below this many. */
export const BUDGET_HINT_AT = 10;
export const savesLeft = (nonce: number): number => Math.max(0, SPONSOR_CAP - nonce);

/** EntryPoint v0.6 (viem's entryPoint06Address) and getNonce(address,uint192); budget.test.ts checks both against viem. */
export const ENTRY_POINT_06 = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789';
const GET_NONCE = '0x35567e1a';

/**
 * The account's EntryPoint key-0 nonce with one raw eth_call, so opening a vault pins it (D8) without loading the write
 * stack: reading and unlocking never fetch it (harden-gas-sponsorship 5.5).
 */
export async function readNonce(client: { request(a: { method: string; params?: unknown }): Promise<unknown> }, owner: string): Promise<bigint> {
  const data = `${GET_NONCE}${owner.slice(2).toLowerCase().padStart(64, '0')}${'0'.repeat(64)}`;
  return BigInt((await client.request({ method: 'eth_call', params: [{ to: ENTRY_POINT_06, data }, 'latest'] })) as string);
}

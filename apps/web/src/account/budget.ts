/**
 * Testnet save-budget hint (vault-list-labels-archive D10). Pimlico sponsors at most 50 operations per sender for its
 * lifetime on testnet (harden-gas-sponsorship D2); the EntryPoint nonce counts the included ones. "About": failed
 * operations may count differently. Pure, so it stays in the initial chunk; the nonce read is in the write stack.
 */
import { bytesEqual } from '../lib/bytes';

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

/**
 * web-review-followups 3: the nonce to pin for a session, read nonce first, then the vault. Only while the chain still
 * holds the session's own blob (so a lagging RPC right after a write, or a write from elsewhere, never moves the pin),
 * and only upward (a reverted save that used a nonce). Otherwise undefined: keep the current pin.
 */
export async function pinIfCurrent(
  client: Parameters<typeof readNonce>[0],
  reader: { getVault(id: `0x${string}`): Promise<{ blob: Uint8Array } | null> },
  s: { vaultId: `0x${string}`; owner: string; blob: Uint8Array; nonce?: bigint | undefined },
): Promise<bigint | undefined> {
  const n = await readNonce(client, s.owner);
  const v = await reader.getVault(s.vaultId);
  return v && bytesEqual(v.blob, s.blob) && (s.nonce === undefined || n > s.nonce) ? n : undefined;
}

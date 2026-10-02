/**
 * Chain ID verification before use (spec deployment-targets "Chain ID verification before use").
 * VaultRegistry has the same CREATE2 address on every chain, so a misconfigured RPC would silently read another chain's
 * registry. Every client is checked once per session (eth_chainId) before any registry read or account action;
 * a mismatch is permanent for that client and is never reported as "no vault".
 */
import { config } from '../config';

export class ChainMismatchError extends Error {
  override name = 'ChainMismatchError';
  constructor(
    readonly expected: number,
    readonly actual: number,
    readonly endpoint: 'rpc' | 'bundler' = 'rpc',
  ) {
    super(`${endpoint} is on chain ${actual}, expected ${expected}`);
  }
}

const verified = new WeakMap<object, Promise<void>>();

export function ensureChain(
  client: { getChainId(): Promise<number> },
  expected: number = config.chainId,
  endpoint: 'rpc' | 'bundler' = 'rpc',
): Promise<void> {
  let p = verified.get(client);
  if (!p) {
    p = client.getChainId().then((actual) => {
      if (actual !== expected) throw new ChainMismatchError(expected, actual, endpoint);
    });
    verified.set(client, p);
    // Transient RPC failures may be retried; a confirmed mismatch stays cached for the session.
    p.catch((e) => {
      if (!(e instanceof ChainMismatchError)) verified.delete(client);
    });
  }
  return p;
}

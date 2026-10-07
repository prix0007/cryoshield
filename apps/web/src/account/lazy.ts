/**
 * Loads the write stack (stack.ts) on demand, so it is not part of the initial /app chunk (harden-gas-sponsorship 5.5).
 * Reading and unlocking never need it; saving, editing and adding a key do, and they await it BEFORE any key tap.
 *
 * A failed chunk load (offline, or a redeploy replaced the hashed chunk) becomes WriteError('LOAD_FAILED'): the flows
 * show a plain "try again" message and keep the draft. The failure is not cached, so the next attempt imports again.
 * The chunk is same-origin, so the strict CSP (script-src 'self') is unchanged.
 */
import type { PublicClient } from 'viem';
import { WriteError } from './errors';
import type { Sponsor } from './writes';

export type WriteStack = typeof import('./stack');

export function writeStackLoader(importer: () => Promise<WriteStack> = () => import('./stack')): () => Promise<WriteStack> {
  let pending: Promise<WriteStack> | null = null;
  return () =>
    (pending ??= importer().catch((e: unknown) => {
      pending = null;
      throw new WriteError('LOAD_FAILED', { cause: e });
    }));
}

/** The app-wide loader (one chunk, fetched at most once per successful load). */
export const loadWriteStack = writeStackLoader();

/** A Sponsor that loads the write stack on its first send, then reuses one real sponsor (Pimlico client) per client. */
export function lazySponsor(client: PublicClient, load: () => Promise<WriteStack> = loadWriteStack): Sponsor {
  let real: Sponsor | undefined;
  return {
    async send(account, calls, onProgress) {
      real ??= (await load()).createSponsor(client);
      return real.send(account, calls, onProgress);
    },
  };
}

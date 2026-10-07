/**
 * Loads the write stack (stack.ts) on demand, so it is not part of the initial /app chunk (harden-gas-sponsorship 5.5).
 * Reading and unlocking never need it; saving, editing and adding a key do, and they await it BEFORE any key tap.
 *
 * A failed chunk load becomes WriteError('LOAD_FAILED'): the flows show a plain message and keep the draft. The failure
 * is not cached, so the next attempt imports again. That fixes a dropped connection. It cannot fix a stale tab: after a
 * redeploy the old hashed chunk is gone (404) and only a reload helps, so the message also offers a reload (design.md,
 * Implementation notes (web)). The chunk is same-origin, so the strict CSP (script-src 'self') is unchanged.
 */
import type { PublicClient } from 'viem';
import { WriteError } from './errors';
import type { Sponsor } from './writes';

export type WriteStack = typeof import('./stack');

export function writeStackLoader(importer: () => Promise<WriteStack> = () => import('./stack')): () => Promise<WriteStack> {
  let pending: Promise<WriteStack> | null = null;
  return () => {
    if (!pending) {
      // Promise.resolve().then: a synchronous throw from the importer also becomes a rejection.
      const attempt: Promise<WriteStack> = Promise.resolve()
        .then(importer)
        .catch((e: unknown) => {
          if (pending === attempt) pending = null; // every concurrent caller shares this failure; the next call retries
          throw new WriteError('LOAD_FAILED', { cause: e });
        });
      pending = attempt;
    }
    return pending;
  };
}

/** The app-wide loader (one chunk, fetched at most once per successful load). */
export const loadWriteStack = writeStackLoader();

/**
 * A Sponsor that loads the write stack on its first send, then reuses one real sponsor (Pimlico client) per client.
 *
 * Invariant (security review LOW 1): every flow that reaches send() has already awaited the SAME loader before its
 * first key tap (operations.ts: saveNewVault, saveEdit, saveAddKey), so here the load is an already-settled promise.
 * No chunk fetch happens between the "touch your key" prompt (onSign) and the signing ceremony inside send().
 */
export function lazySponsor(client: PublicClient, load: () => Promise<WriteStack> = loadWriteStack): Sponsor {
  let real: Promise<Sponsor> | null = null;
  return {
    async send(account, calls, onProgress) {
      if (!real) {
        const attempt: Promise<Sponsor> = load()
          .then((m) => m.createSponsor(client))
          .catch((e: unknown) => {
            if (real === attempt) real = null;
            throw e;
          });
        real = attempt;
      }
      return (await real).send(account, calls, onProgress);
    },
  };
}

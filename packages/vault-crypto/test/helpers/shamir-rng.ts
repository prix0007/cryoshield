import { replayRng, type ReplayRng } from '../../src/rng.js';

/**
 * Test seam: the `shamir-secret-sharing` CSPRNG module is mocked in tests to
 * draw from this replay stream (see design.md, "Shamir randomness injection").
 */
let current: ReplayRng = replayRng(new Uint8Array(0));
export const shamirRandom = {
  load(bytes: Uint8Array): void {
    current = replayRng(bytes);
  },
  next(n: number): Uint8Array {
    return current.randomBytes(n);
  },
  remaining(): number {
    return current.remaining();
  },
};

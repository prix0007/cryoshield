/**
 * @cryoshield/vault-crypto/testing: deterministic helpers for tests and for
 * reproducing test vectors. NEVER import this from production code: a replay
 * RNG makes every key, salt, and nonce predictable.
 */
export { replayRng, RngExhaustedError, type ReplayRng } from './rng.js';

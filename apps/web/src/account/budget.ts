/**
 * Testnet save-budget hint (vault-list-labels-archive D10). Pimlico sponsors at most 50 operations per sender for its
 * lifetime on testnet (harden-gas-sponsorship D2); the EntryPoint nonce counts the included ones. "About": failed
 * operations may count differently. Pure, so it stays in the initial chunk; the nonce read is in the write stack.
 */
export const SPONSOR_CAP = 50;
/** Shown only at or below this many. */
export const BUDGET_HINT_AT = 10;
export const savesLeft = (nonce: number): number => Math.max(0, SPONSOR_CAP - nonce);

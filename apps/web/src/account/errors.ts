/**
 * The light part of the write path that the initial /app chunk needs: the error type the UI maps to plain words and
 * the save-checklist events. It imports no viem account abstraction, Pimlico client or wallet code, so those stay in
 * the lazily loaded write stack (harden-gas-sponsorship 5.5; see lazy.ts). writes.ts re-exports all of this.
 */
import type { Hex } from 'viem';
import type { KeyError } from '../webauthn';

export type WriteErrorCode =
  | 'SPONSORSHIP_REFUSED' // paymaster policy refused (cap reached, outside policy, balance exhausted)
  | 'ALREADY_HAS_VAULT'
  | 'TOO_MANY_KEYS'
  | 'TOO_LARGE'
  | 'NOT_OWNER'
  | 'DUPLICATE_KEY'
  | 'REVERTED' // included, inner call reverted: nothing saved
  | 'NOT_CONFIRMED' // receipt ok but read-back differs / timed out
  | 'KEY' // WebAuthn problem during signing (see .keyError)
  | 'POLICY' // our own allowlist refused the call (programming error)
  | 'OWNER_MISMATCH' // account owners don't line up with the blob's entries (owner index == entry index)
  | 'READ_ONLY' // a legacy VaultRegistry v1 vault: clients never write to v1
  | 'LOAD_FAILED' // the lazily loaded write code could not be fetched (offline, or a redeploy replaced the chunk)
  | 'NETWORK';

export class WriteError extends Error {
  override name = 'WriteError';
  constructor(
    readonly code: WriteErrorCode,
    readonly detail: { locator?: Hex; keyError?: KeyError; cause?: unknown } = {},
  ) {
    super(code);
  }
}

/** Real write-path events, in order, for the save checklist (app-motion-ux D5). */
export type SaveStage = 'encrypted' | 'sponsored' | 'sent' | 'confirmed';
export type ProgressListener = (stage: SaveStage) => void;

/**
 * Fire-and-forget notification: never awaited, and a throwing (or async-rejecting) listener can never break, delay
 * or alter a write.
 */
export function notify(listener: ProgressListener | undefined, stage: SaveStage): void {
  if (!listener) return;
  try {
    const r = listener(stage) as unknown;
    if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(() => undefined);
  } catch {
    /* presentation only */
  }
}

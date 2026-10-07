/**
 * Payload v2 Archive and clear (docs/spec/payload-v2.md section 8; vault-list-labels-archive D4, A4). Part of the codec,
 * kept in its own module so it ships in the lazily loaded vault list chunk with the only code that uses it.
 */
import { decodeVaultPayload, PayloadError, writeVaultPayload, type VaultPayloadInput } from './payload';

/**
 * Archive and clear (spec section 8, D4): keeps the name, sets `a`, no items, `z` sized so the payload keeps the
 * previous length (exact), or stays in the previous 64-byte block (gap). Throws PayloadError if it can't fit.
 */
export function archiveAndClearPayload(previous: Uint8Array, maxPayloadBytes: number): Uint8Array {
  const prev = decodeVaultPayload(previous);
  const base: VaultPayloadInput = { archived: true, items: [] };
  if (prev.name !== undefined) base.name = prev.name;
  const c0 = writeVaultPayload(base).length;
  const p = previous.length;
  const block = 64 * Math.ceil((p + 2) / 64) - 2;
  const zeros = p - c0 - 7 >= 1 ? p - c0 - 7 : c0 < p && c0 + 8 <= block ? 1 : 0;
  const out = writeVaultPayload(zeros ? { ...base, pad: '0'.repeat(zeros) } : base);
  if (out.length > maxPayloadBytes) throw new PayloadError('MALFORMED');
  return out;
}

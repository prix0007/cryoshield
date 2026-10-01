/**
 * Vault payload encoding v1 (spec vault-web-app "Vault payload encoding v1"; docs/payload-v1.md).
 * The decrypted vault secret is UTF-8 JSON: {"v":1,"items":[{"l":<label>,"s":<secret>},...]}.
 */

export interface SecretItem {
  label: string;
  secret: string;
}

export type PayloadErrorCode = 'UNKNOWN_VERSION' | 'MALFORMED';

export class PayloadError extends Error {
  override name = 'PayloadError';
  constructor(readonly code: PayloadErrorCode) {
    super(code === 'UNKNOWN_VERSION' ? 'payload made by a newer version' : 'payload is malformed');
  }
}

export const MAX_LABEL_CHARS = 64;

function validItem(x: unknown): x is { l: string; s: string } {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const keys = Object.keys(x);
  if (keys.length !== 2 || !keys.includes('l') || !keys.includes('s')) return false;
  const { l, s } = x as { l: unknown; s: unknown };
  return typeof l === 'string' && typeof s === 'string' && [...l].length <= MAX_LABEL_CHARS;
}

export function encodePayload(items: readonly SecretItem[]): Uint8Array {
  if (items.length === 0) throw new PayloadError('MALFORMED');
  const out = { v: 1, items: items.map((i) => ({ l: i.label, s: i.secret })) };
  if (!out.items.every(validItem)) throw new PayloadError('MALFORMED');
  // Copy into this realm's Uint8Array (jsdom's TextEncoder returns a foreign-realm array).
  return new Uint8Array(new TextEncoder().encode(JSON.stringify(out)));
}

export function decodePayload(bytes: Uint8Array): SecretItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new PayloadError('MALFORMED');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new PayloadError('MALFORMED');
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.v === 'number' && obj.v !== 1) throw new PayloadError('UNKNOWN_VERSION');
  const keys = Object.keys(obj);
  if (obj.v !== 1 || keys.length !== 2 || !Array.isArray(obj.items)) throw new PayloadError('MALFORMED');
  if (obj.items.length === 0 || !obj.items.every(validItem)) throw new PayloadError('MALFORMED');
  return (obj.items as { l: string; s: string }[]).map((i) => ({ label: i.l, secret: i.s }));
}

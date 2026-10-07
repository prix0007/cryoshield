/**
 * Vault payload encoding v1 and v2 (docs/spec/payload-v2.md; change vault-list-labels-archive D1–D4).
 * v1: {"v":1,"items":[{"l":<label>,"s":<secret>},...]}, decoded with the deployed rules, unchanged.
 * v2: {"v":2,"n":<name>?,"a":true?,"items":[...],"z":"0…"?}, strict and canonical (decode, validate, re-encode,
 * byte-compare). Writers emit the minimal version (D2).
 */

export interface SecretItem {
  label: string;
  secret: string;
}

/** One decoded payload, v1 or v2 (spec section 2). `name`/`pad` absent = null in the vectors. */
export interface VaultPayload {
  version: 1 | 2;
  name?: string;
  archived: boolean;
  items: SecretItem[];
  pad?: string;
}
/** What a writer is given: the version follows from the content (D2). */
export type VaultPayloadInput = Omit<VaultPayload, 'version'>;

export type PayloadErrorCode = 'UNKNOWN_VERSION' | 'MALFORMED';

export class PayloadError extends Error {
  override name = 'PayloadError';
  constructor(readonly code: PayloadErrorCode) {
    super(code === 'UNKNOWN_VERSION' ? 'payload made by a newer version' : 'payload is malformed');
  }
}

export const MAX_LABEL_CHARS = 64;
export const MAX_NAME_CHARS = 40;
/** D11: the bytes of `"a":true,` that the editor keeps free so a full vault can still be archived. */
export const ARCHIVE_RESERVE = 9;
const MAX_DEPTH = 64;
const V2_KEYS = new Set(['v', 'n', 'a', 'items', 'z']);

/** Name rule (spec 4.3): 1–40 code points, no Cc, U+061C, U+200E/F, U+2028–U+202E, U+2066–U+206F. */
const NAME_RE = /^[^\0-\x1f\x7f-\x9f\u061c\u200e\u200f\u2028-\u202e\u2066-\u206f]{1,40}$/u;
/** In u-mode a paired surrogate is one code point, so this matches only unpaired surrogates. */
const LONE_SURROGATE = /[\ud800-\udfff]/u;
export const validName = (n: string): boolean => NAME_RE.test(n) && !LONE_SURROGATE.test(n);

const MALFORMED = () => new PayloadError('MALFORMED');
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function validItem(x: unknown): x is { l: string; s: string } {
  if (!isObj(x)) return false;
  const keys = Object.keys(x);
  if (keys.length !== 2 || !keys.includes('l') || !keys.includes('s')) return false;
  const { l, s } = x as { l: unknown; s: unknown };
  return typeof l === 'string' && typeof s === 'string' && [...l].length <= MAX_LABEL_CHARS;
}

// Copy into this realm's Uint8Array (jsdom's TextEncoder returns a foreign-realm array).
const utf8 = (s: string) => new Uint8Array(new TextEncoder().encode(s));

/** The canonical bytes (spec section 5): JSON.stringify in member order v, n, a, items, z. No validation. */
function encode(p: VaultPayload): Uint8Array {
  const o: Record<string, unknown> = { v: p.version };
  if (p.version === 2) {
    if (p.name !== undefined) o.n = p.name;
    if (p.archived) o.a = true;
  }
  o.items = p.items.map((i) => ({ l: i.label, s: i.secret }));
  if (p.version === 2 && p.pad !== undefined) o.z = p.pad;
  return utf8(JSON.stringify(o));
}

/** Deepest simultaneous nesting of arrays/objects, outside strings (spec 7 step 2). */
function depth(text: string): number {
  let d = 0;
  let max = 0;
  let str = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (str) {
      if (c === '\\') i++;
      else if (c === '"') str = false;
    } else if (c === '"') str = true;
    else if (c === '[' || c === '{') max = Math.max(max, ++d);
    else if (c === ']' || c === '}') d--;
  }
  return max;
}

const toItems = (items: { l: string; s: string }[]): SecretItem[] => items.map((i) => ({ label: i.l, secret: i.s }));

/** Decodes v1 (deployed rules) or v2 (strict canonical). Throws PayloadError; never returns a partial result. */
export function decodeVaultPayload(bytes: Uint8Array): VaultPayload {
  let parsed: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); // strips one BOM
    if (depth(text) > MAX_DEPTH) throw MALFORMED();
    parsed = JSON.parse(text);
  } catch {
    throw MALFORMED();
  }
  if (!isObj(parsed)) throw MALFORMED();
  const { v, n, a, items, z } = parsed;
  if (typeof v !== 'number') throw MALFORMED();
  if (v === 1) {
    if (Object.keys(parsed).length !== 2 || !Array.isArray(items) || items.length === 0 || !items.every(validItem)) throw MALFORMED();
    return { version: 1, archived: false, items: toItems(items) };
  }
  if (v !== 2) throw new PayloadError('UNKNOWN_VERSION');
  if (!Object.keys(parsed).every((k) => V2_KEYS.has(k)) || !Array.isArray(items) || !items.every(validItem)) throw MALFORMED();
  const out: VaultPayload = { version: 2, archived: a === true, items: toItems(items) };
  if (n !== undefined) out.name = n as string;
  if (z !== undefined) out.pad = z as string;
  if (!valid(out) || ('a' in parsed && a !== true)) throw MALFORMED();
  const re = encode(out);
  if (re.length !== bytes.length || re.some((b, i) => b !== bytes[i])) throw MALFORMED();
  return out;
}

/** v2 structure rules (spec sections 3–4), beyond what validItem checks. */
function valid(p: VaultPayload): boolean {
  if (p.name !== undefined && (typeof p.name !== 'string' || !validName(p.name))) return false;
  if (p.pad !== undefined && (typeof p.pad !== 'string' || !/^0+$/.test(p.pad) || p.items.length > 0)) return false;
  return p.items.every((i) => !LONE_SURROGATE.test(i.label) && !LONE_SURROGATE.test(i.secret));
}

/** The minimal-version writer (D2): v1 when unnamed, active, unpadded and non-empty; otherwise v2. */
export function writeVaultPayload(p: VaultPayloadInput): Uint8Array {
  const v1 = p.name === undefined && !p.archived && p.pad === undefined && p.items.length > 0;
  const out = encode({ ...p, version: v1 ? 1 : 2 });
  decodeVaultPayload(out); // a writer never emits what a decoder refuses
  return out;
}

/** A save of new items keeps the name and the archived flag, and drops `z` once there is an item (spec section 6). */
export function withItems(p: VaultPayloadInput, items: SecretItem[]): VaultPayloadInput {
  const out: VaultPayloadInput = { archived: p.archived, items };
  if (p.name !== undefined) out.name = p.name;
  if (p.pad !== undefined && items.length === 0) out.pad = p.pad;
  return out;
}

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
  if (out.length > maxPayloadBytes) throw MALFORMED();
  return out;
}

/** v1 items encoder (kept for callers that have no payload context, e.g. tests). Same bytes as before. */
export function encodePayload(items: readonly SecretItem[]): Uint8Array {
  if (items.length === 0) throw MALFORMED();
  return writeVaultPayload({ archived: false, items: [...items] });
}

/** The deployed v1-only decoder (kept verbatim: the vectors' regression test runs against it). */
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

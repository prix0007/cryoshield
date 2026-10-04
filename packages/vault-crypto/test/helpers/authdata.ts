/** Test-only builders for WebAuthn authenticatorData (registration form: attested credential data + extensions). */

/** Minimal canonical CBOR encoder for the values these tests need. */
export function cbor(v: unknown): Uint8Array {
  const head = (major: number, n: number): number[] => {
    if (n < 24) return [(major << 5) | n];
    if (n < 0x100) return [(major << 5) | 24, n];
    if (n < 0x10000) return [(major << 5) | 25, n >> 8, n & 0xff];
    return [(major << 5) | 26, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  };
  if (typeof v === 'number') return Uint8Array.from(v >= 0 ? head(0, v) : head(1, -1 - v));
  if (typeof v === 'boolean') return Uint8Array.of(v ? 0xf5 : 0xf4);
  if (typeof v === 'string') {
    const b = new TextEncoder().encode(v);
    return Uint8Array.from([...head(3, b.length), ...b]);
  }
  if (v instanceof Uint8Array) return Uint8Array.from([...head(2, v.length), ...v]);
  if (v instanceof Map) {
    const parts: number[] = head(5, v.size);
    for (const [k, val] of v) parts.push(...cbor(k), ...cbor(val));
    return Uint8Array.from(parts);
  }
  throw new Error('unsupported');
}

/** EC2 / P-256 / ES256 COSE public key. */
export const coseKey = () =>
  cbor(new Map<unknown, unknown>([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(32).fill(7)], [-3, new Uint8Array(32).fill(9)]]));

const UP = 0x01;
const UV = 0x04;
const AT = 0x40;
const ED = 0x80;

/**
 * Registration authenticatorData. `extensions` is the authenticator extension output map (omitted: ED clear).
 * Defaults: UP|UV|AT, a 16-byte credential ID, an ES256 COSE key.
 */
export function regAuthData(opts: { extensions?: Map<string, unknown>; flags?: number; at?: boolean } = {}): Uint8Array {
  const at = opts.at ?? true;
  let flags = opts.flags ?? UP | UV | (at ? AT : 0);
  if (opts.extensions) flags |= ED;
  const out: number[] = [...new Uint8Array(32).fill(1), flags, 0, 0, 0, 1];
  if (at) {
    const credId = new Uint8Array(16).fill(5);
    out.push(...new Uint8Array(16), 0, credId.length, ...credId, ...coseKey());
  }
  if (opts.extensions) out.push(...cbor(opts.extensions));
  return Uint8Array.from(out);
}

export const credProtect = (level: number, extra: [string, unknown][] = []) => new Map<string, unknown>([...extra, ['credProtect', level]]);

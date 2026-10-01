/** Small byte helpers. No crypto here: all vault cryptography lives in @cryoshield/vault-crypto. */

export type Hex = `0x${string}`;

export function toHex(b: Uint8Array): Hex {
  let s = '0x';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s as Hex;
}

export function fromHex(h: string): Uint8Array {
  const s = h.startsWith('0x') ? h.slice(2) : h;
  if (s.length % 2 !== 0 || /[^0-9a-fA-F]/.test(s)) throw new Error('invalid hex');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}

export function toBase64Url(b: Uint8Array): string {
  let bin = '';
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Overwrites buffers with zeros (best effort; JS engines may keep copies). */
export function wipe(...bufs: (Uint8Array | null | undefined)[]): void {
  for (const b of bufs) b?.fill(0);
}

/** Copy into a plain ArrayBuffer-backed array (what WebCrypto/WebAuthn BufferSource types require). */
export function ab(b: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(b);
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

/** Copies an ArrayBuffer or view into a fresh Uint8Array (realm-independent). */
export function toBytes(x: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength).slice();
  return new Uint8Array(x as ArrayBuffer).slice();
}

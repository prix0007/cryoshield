/**
 * credProtect check on registration authenticatorData (spec §3.1a, enforce-credprotect-uv / audit AA-H1).
 *
 * Layout (WebAuthn §6.1): rpIdHash(32) | flags(1) | signCount(4) | [AT: aaguid(16) | credIdLen(2) | credId |
 * credentialPublicKey (CBOR)] | [ED: extensions (CBOR map)]. The authenticator's credProtect output is the integer
 * under "credProtect" in that extensions map. Browsers do not surface it in getClientExtensionResults(), so this is
 * the only place a client can confirm it. Parsing is strict and bounded: anything unexpected means "not confirmed".
 */
import { VaultError } from './errors.js';

/** CTAP 2.1 credProtect level 3: userVerificationRequired. */
export const CRED_PROTECT_UV_REQUIRED = 3;

const FLAG_AT = 0x40;
const FLAG_ED = 0x80;
const MAX_DEPTH = 8;

class Bad extends Error {}

/** Minimal bounded CBOR reader (definite lengths only, as CTAP2 canonical CBOR requires). */
class Reader {
  constructor(private b: Uint8Array, public pos: number) {}
  private byte(): number {
    if (this.pos >= this.b.length) throw new Bad();
    return this.b[this.pos++]!;
  }
  private arg(info: number): number {
    if (info < 24) return info;
    const n = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : -1;
    if (n < 0) throw new Bad(); // indefinite lengths / reserved values are not canonical CTAP2
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + this.byte();
    if (!Number.isSafeInteger(v)) throw new Bad();
    // Canonical CBOR: the shortest encoding only (e.g. 3 must be 0x03, never 0x18 0x03).
    const min = n === 1 ? 24 : n === 2 ? 0x100 : n === 4 ? 0x10000 : 0x100000000;
    if (v < min) throw new Bad();
    return v;
  }
  private take(n: number): Uint8Array {
    if (n > this.b.length - this.pos) throw new Bad();
    const out = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  /** Reads one item. Integers come back as numbers, text as strings, maps as Map; other items as undefined. */
  item(depth = 0): unknown {
    if (depth > MAX_DEPTH) throw new Bad();
    const ib = this.byte();
    const major = ib >> 5;
    const info = ib & 0x1f;
    switch (major) {
      case 0:
        return this.arg(info);
      case 1:
        return -1 - this.arg(info);
      case 2:
        this.take(this.arg(info));
        return undefined;
      case 3:
        return new TextDecoder('utf-8', { fatal: true }).decode(this.take(this.arg(info)));
      case 4: {
        const n = this.arg(info);
        for (let i = 0; i < n; i++) this.item(depth + 1);
        return undefined;
      }
      case 5: {
        const n = this.arg(info);
        const m = new Map<unknown, unknown>();
        for (let i = 0; i < n; i++) {
          const k = this.item(depth + 1);
          if (m.has(k)) throw new Bad(); // duplicate keys are not canonical
          m.set(k, this.item(depth + 1));
        }
        return m;
      }
      case 7:
        if (info === 20 || info === 21 || info === 22) return undefined; // false / true / null
        throw new Bad();
      default:
        throw new Bad(); // tags (6) are not used in authenticator data
    }
  }
}

/**
 * The credProtect level the authenticator reported in a create() response's authenticatorData, or undefined when it
 * reported none or the data cannot be parsed exactly. Throws INVALID_ARGUMENT for data shorter than 37 bytes.
 */
export function credProtectLevel(authenticatorData: Uint8Array): number | undefined {
  if (!(authenticatorData instanceof Uint8Array) || authenticatorData.length < 37) {
    throw new VaultError('INVALID_ARGUMENT', { hint: 'authenticatorData must be at least 37 bytes' });
  }
  const flags = authenticatorData[32]!;
  if (!(flags & FLAG_AT) || !(flags & FLAG_ED)) return undefined;
  try {
    let pos = 37 + 16; // aaguid
    if (pos + 2 > authenticatorData.length) return undefined;
    const credIdLen = (authenticatorData[pos]! << 8) | authenticatorData[pos + 1]!;
    pos += 2 + credIdLen;
    if (pos > authenticatorData.length) return undefined;
    const r = new Reader(authenticatorData, pos);
    if (!(r.item() instanceof Map)) return undefined; // credentialPublicKey must be a COSE map
    const ext = r.item();
    if (r.pos !== authenticatorData.length || !(ext instanceof Map)) return undefined; // nothing may follow
    const level = ext.get('credProtect');
    return typeof level === 'number' && Number.isInteger(level) ? level : undefined;
  } catch (e) {
    if (e instanceof Bad || e instanceof TypeError) return undefined;
    throw e;
  }
}

/**
 * Spec §3.1a: call on the `authenticatorData` of every create() response BEFORE the credential is used for a vault.
 * Throws CRED_PROTECT_UNSUPPORTED unless the authenticator confirmed credProtect level 3 (userVerificationRequired).
 */
export function assertCredProtectUvRequired(authenticatorData: Uint8Array): void {
  if (credProtectLevel(authenticatorData) !== CRED_PROTECT_UV_REQUIRED) throw new VaultError('CRED_PROTECT_UNSUPPORTED');
}

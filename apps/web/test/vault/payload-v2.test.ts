/**
 * Payload v2 codec against the shared vectors (change vault-list-labels-archive, task 1.2 [fe]).
 * Spec: docs/spec/payload-v2.md. Vectors: docs/spec/payload-vectors.json (task 1.1 [cry]).
 *
 * Written ahead of the codec: each test is `todo` until src/vault/payload.ts exports the
 * function it needs, then it runs (and must pass) automatically. The export names below are a
 * proposal from task 1.1; rename them here if the implementation chooses others.
 *
 *   decodeVaultPayload(bytes): VaultPayload          throws PayloadError('MALFORMED' | 'UNKNOWN_VERSION')
 *   writeVaultPayload(p without version): Uint8Array  minimal version (spec section 6)
 *   archiveAndClearPayload(previous, maxPayloadBytes): Uint8Array   (spec section 8)
 *
 * VaultPayload = { version: 1 | 2; name?: string; archived: boolean; items: SecretItem[]; pad?: string }.
 */
import { describe, expect, it } from 'vitest';
import vectorsText from '../../../../docs/spec/payload-vectors.json?raw';
import * as payload from '../../src/vault/payload';

interface Item {
  label: string;
  secret: string;
}
interface VaultPayloadShape {
  version: 1 | 2;
  name?: string | null | undefined;
  archived: boolean;
  items: Item[];
  pad?: string | null | undefined;
}
interface V2Api {
  decodeVaultPayload(bytes: Uint8Array): VaultPayloadShape;
  writeVaultPayload(p: Omit<VaultPayloadShape, 'version'>): Uint8Array;
  archiveAndClearPayload(previous: Uint8Array, maxPayloadBytes: number): Uint8Array;
}
const api = payload as unknown as Partial<V2Api>;
const has = (k: keyof V2Api): boolean => typeof api[k] === 'function';
const testIf = (k: keyof V2Api) => (has(k) ? it : it.todo);

const hex = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
};
const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

interface VectorDecoded {
  version: number;
  name: string | null;
  archived: boolean;
  items: { l: string; s: string }[];
  pad: string | null;
}
interface Vectors {
  name: string;
  spec: string;
  generatedBy: string;
  errorClasses: string[];
  positive: { id: string; hex: string; text: string | null; decoded: VectorDecoded; canonicalHex: string }[];
  negative: { id: string; hex: string; text: string | null; error: string; canonicalHex: string | null }[];
  writer: { id: string; input: Omit<VectorDecoded, 'version'>; expectedVersion: number; expectedHex: string }[];
  archiveClear: {
    id: string;
    rule: string;
    previousHex: string;
    previousLength: number;
    maxPayloadBytes: number;
    expectedHex: string;
    expectedLength: number;
  }[];
  blobs: {
    id: string;
    payloadVector: string;
    payloadHex: string;
    vaultId: string;
    rpId: string;
    credentials: { name: string; id: string; prf: string }[];
    updates: string | null;
    sameLengthAs: string | null;
    rng: string;
    blob: string;
    blobLength: number;
  }[];
}
// Loaded as text and parsed with JSON.parse: some vectors hold escaped unpaired surrogates (v1 legacy), which
// JSON.parse accepts but Vite's JSON module loader rejects.
const vectors = JSON.parse(vectorsText) as Vectors;

const fromVector = (d: VectorDecoded): Omit<VaultPayloadShape, 'version'> => ({
  ...(d.name === null ? {} : { name: d.name }),
  archived: d.archived,
  items: d.items.map((i) => ({ label: i.l, secret: i.s })),
  ...(d.pad === null ? {} : { pad: d.pad }),
});
const toVector = (p: VaultPayloadShape): VectorDecoded => ({
  version: p.version,
  name: p.name ?? null,
  archived: p.archived,
  items: p.items.map((i) => ({ l: i.label, s: i.secret })),
  pad: p.pad ?? null,
});
/** The version the writer picks for this structure (spec section 6). */
const writerVersion = (d: VectorDecoded): number =>
  d.name === null && !d.archived && d.pad === null && d.items.length > 0 ? 1 : 2;

function errorCode(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(payload.PayloadError);
    return (e as payload.PayloadError).code;
  }
}

// Not todo: runs today against the deployed v1 decoder. It proves the vectors never make v1 stricter than what
// ships (design A7, reversed): every v1 positive opens with today's decodePayload, every negative is refused.
describe('payload vectors vs the deployed v1 decoder (regression)', () => {
  for (const c of vectors.positive.filter((p) => p.decoded.version === 1)) {
    it(`${c.id} decodes with today's decodePayload`, () => {
      expect(payload.decodePayload(hex(c.hex))).toEqual(c.decoded.items.map((i) => ({ label: i.l, secret: i.s })));
    });
  }
  for (const c of vectors.negative) {
    it(`${c.id} is refused by today's decodePayload`, () => {
      expect(() => payload.decodePayload(hex(c.hex))).toThrow(payload.PayloadError);
    });
  }
});

describe('payload v2: positive vectors', () => {
  for (const c of vectors.positive) {
    testIf('decodeVaultPayload')(`${c.id} decodes to the listed structure`, () => {
      expect(toVector(api.decodeVaultPayload!(hex(c.hex)))).toEqual(c.decoded);
    });
    // A non-minimal v2 (vector v2-non-minimal) decodes, but the writer would emit v1 for it.
    if (c.decoded.version === writerVersion(c.decoded)) {
      testIf('writeVaultPayload')(`${c.id} re-encodes to the identical bytes`, () => {
        expect(toHex(api.writeVaultPayload!(fromVector(c.decoded)))).toBe(c.canonicalHex);
      });
    }
  }
});

describe('payload v2: negative vectors', () => {
  for (const c of vectors.negative) {
    testIf('decodeVaultPayload')(`${c.id} is rejected as ${c.error}`, () => {
      expect(errorCode(() => api.decodeVaultPayload!(hex(c.hex)))).toBe(c.error);
    });
  }
});

describe('payload v2: minimal-version writer', () => {
  for (const c of vectors.writer) {
    testIf('writeVaultPayload')(`${c.id}`, () => {
      const out = api.writeVaultPayload!(fromVector({ ...c.input, version: c.expectedVersion }));
      expect(toHex(out)).toBe(c.expectedHex);
    });
  }
});

describe('payload v2: archive and clear', () => {
  for (const c of vectors.archiveClear) {
    testIf('archiveAndClearPayload')(`${c.id} (${c.rule})`, () => {
      const out = api.archiveAndClearPayload!(hex(c.previousHex), c.maxPayloadBytes);
      expect(toHex(out)).toBe(c.expectedHex);
      expect(out.length).toBe(c.expectedLength);
    });
  }
});

describe('payload v2: blob vectors carry valid payloads', () => {
  for (const b of vectors.blobs) {
    testIf('decodeVaultPayload')(`${b.id} payload decodes`, () => {
      expect(() => api.decodeVaultPayload!(hex(b.payloadHex))).not.toThrow();
    });
  }
});

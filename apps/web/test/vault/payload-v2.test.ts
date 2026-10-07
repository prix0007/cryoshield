/**
 * Payload v2 codec against the shared vectors (change vault-list-labels-archive, task 1.2 [fe]).
 * Spec: docs/spec/payload-v2.md. Vectors: docs/spec/payload-vectors.json (task 1.1 [cry]).
 *
 * Hard tests (design review L1): every vector runs against the codec; a missing export fails, it is never skipped.
 *
 *   decodeVaultPayload(bytes): VaultPayload          throws PayloadError('MALFORMED' | 'UNKNOWN_VERSION')
 *   writeVaultPayload(p without version): Uint8Array  minimal version (spec section 6)
 *   archiveAndClearPayload(previous, maxPayloadBytes): Uint8Array   (spec section 8)
 *
 * VaultPayload = { version: 1 | 2; name?: string; archived: boolean; items: SecretItem[]; pad?: string }.
 */
import { describe, expect, it } from 'vitest';
import vectorsText from '../../../../docs/spec/payload-vectors.json?raw';
import { selectVault } from '@cryoshield/vault-crypto';
import * as codec from '../../src/vault/payload';
import { archiveAndClearPayload } from '../../src/vault/payload-clear';

const payload = { ...codec, archiveAndClearPayload };

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
const api: V2Api = payload;

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
    expect(e).toBeInstanceOf(codec.PayloadError);
    return (e as codec.PayloadError).code;
  }
}

// Runs against the deployed v1 decoder, kept unchanged. It proves the vectors never make v1 stricter than what
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

describe('payload v2: the codec exports', () => {
  it('exports every function the vectors need (no skipped tests)', () => {
    for (const k of ['decodeVaultPayload', 'writeVaultPayload', 'archiveAndClearPayload'] as const) expect(typeof payload[k]).toBe('function');
  });
  it('has at least one vector in every section', () => {
    for (const k of ['positive', 'negative', 'writer', 'archiveClear', 'blobs'] as const) expect(vectors[k].length).toBeGreaterThan(0);
  });
});

describe('payload v2: positive vectors', () => {
  for (const c of vectors.positive) {
    it(`${c.id} decodes to the listed structure`, () => {
      expect(toVector(api.decodeVaultPayload(hex(c.hex)))).toEqual(c.decoded);
    });
    // A non-minimal v2 (vector v2-non-minimal) decodes, but the writer would emit v1 for it.
    if (c.decoded.version === writerVersion(c.decoded)) {
      it(`${c.id} re-encodes to the identical bytes`, () => {
        expect(toHex(api.writeVaultPayload(fromVector(c.decoded)))).toBe(c.canonicalHex);
      });
    }
  }
});

describe('payload v2: negative vectors', () => {
  for (const c of vectors.negative) {
    it(`${c.id} is rejected as ${c.error}`, () => {
      expect(errorCode(() => api.decodeVaultPayload(hex(c.hex)))).toBe(c.error);
    });
  }
});

describe('payload v2: minimal-version writer', () => {
  for (const c of vectors.writer) {
    it(`${c.id}`, () => {
      const out = api.writeVaultPayload(fromVector({ ...c.input, version: c.expectedVersion }));
      expect(toHex(out)).toBe(c.expectedHex);
    });
  }
});

describe('payload v2: archive and clear', () => {
  for (const c of vectors.archiveClear) {
    it(`${c.id} (${c.rule})`, () => {
      const out = api.archiveAndClearPayload(hex(c.previousHex), c.maxPayloadBytes);
      expect(toHex(out)).toBe(c.expectedHex);
      expect(out.length).toBe(c.expectedLength);
    });
  }
});

describe('payload v2: blob vectors open and decode', () => {
  const byId = new Map(vectors.positive.map((p) => [p.id, p]));
  for (const b of vectors.blobs) {
    it(`${b.id} opens with each test key and decodes as ${b.payloadVector}`, async () => {
      for (const c of b.credentials) {
        const { secret } = await selectVault([{ vaultId: hex(b.vaultId.replace(/^0x/, "")), blob: hex(b.blob) }], hex(c.prf));
        expect(toHex(secret)).toBe(b.payloadHex);
        const want = byId.get(b.payloadVector)?.decoded;
        if (want) expect(toVector(api.decodeVaultPayload(secret))).toEqual(want);
        else expect(() => api.decodeVaultPayload(secret)).not.toThrow();
      }
    });
  }
  it('archive and clear keeps the blob length (blob-clear-before / blob-clear-after)', () => {
    const before = vectors.blobs.find((b) => b.id === 'blob-clear-before')!;
    const after = vectors.blobs.find((b) => b.id === 'blob-clear-after')!;
    expect(hex(after.blob).length).toBe(hex(before.blob).length);
  });
});

describe('payload v2: the writer refuses what a decoder would refuse', () => {
  const item = { label: 'a', secret: 'b' };
  it.each([
    ['an empty name', { name: '', archived: false, items: [item] }],
    ['a 41-code-point name', { name: 'N'.repeat(41), archived: false, items: [item] }],
    ['a name with U+202E', { name: 'a\u202eb', archived: false, items: [item] }],
    ['a name with a newline', { name: 'a\nb', archived: false, items: [item] }],
    ['a name with LRM', { name: 'a\u200eb', archived: false, items: [item] }],
    ['a lone surrogate in a v2 secret', { name: 'x', archived: false, items: [{ label: 'a', secret: '\udc00' }] }],
    ['a pad next to items', { archived: true, items: [item], pad: '0' }],
    ['a pad that is not zeros', { archived: true, items: [], pad: '01' }],
    ['a 65-code-point label', { archived: false, items: [{ label: 'x'.repeat(65), secret: 'b' }] }],
  ])('refuses %s', (_, p) => {
    expect(errorCode(() => api.writeVaultPayload(p as Omit<VaultPayloadShape, 'version'>))).toBe('MALFORMED');
  });
  it('allows ZWJ in a name (emoji sequences)', () => {
    const out = api.writeVaultPayload({ name: '👨\u200d👩', archived: false, items: [item] });
    expect(api.decodeVaultPayload(out).name).toBe('👨\u200d👩');
  });
  it('a later save with items drops z', () => {
    const cleared = payload.decodeVaultPayload(api.writeVaultPayload({ name: 'F', archived: true, items: [], pad: '000' }));
    const next = payload.withItems(cleared, [item]);
    expect(next.pad).toBeUndefined();
    expect(new TextDecoder().decode(api.writeVaultPayload(next))).toBe('{"v":2,"n":"F","a":true,"items":[{"l":"a","s":"b"}]}');
  });
  it('unarchiving a cleared vault keeps z', () => {
    const cleared = payload.decodeVaultPayload(api.writeVaultPayload({ name: 'F', archived: true, items: [], pad: '000' }));
    expect(api.writeVaultPayload({ ...cleared, archived: false }).length).toBe(api.writeVaultPayload(cleared).length - 9);
    expect(api.decodeVaultPayload(api.writeVaultPayload({ ...cleared, archived: false })).pad).toBe('000');
  });
  it('refuses to clear a payload that would not fit', () => {
    const prev = api.writeVaultPayload({ name: 'N'.repeat(40), archived: false, items: [{ label: '', secret: '' }] });
    expect(() => api.archiveAndClearPayload(prev, prev.length)).toThrow(payload.PayloadError);
  });
});

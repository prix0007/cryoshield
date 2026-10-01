import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodePayload, encodePayload, PayloadError } from '../../src/vault/payload';

const dec = new TextDecoder();

describe('payload v1 (4.1)', () => {
  it('round-trips labels and secrets in order', () => {
    const items = [
      { label: 'Bitcoin seed', secret: 'abandon abandon art' },
      { label: 'GitHub recovery codes', secret: 'a1b2-c3d4\nE5F6-g7h8' },
    ];
    const bytes = encodePayload(items);
    expect(dec.decode(bytes)).toBe('{"v":1,"items":[{"l":"Bitcoin seed","s":"abandon abandon art"},{"l":"GitHub recovery codes","s":"a1b2-c3d4\\nE5F6-g7h8"}]}');
    expect(decodePayload(bytes)).toEqual(items);
  });

  it.each([
    ['unknown version', '{"v":2,"items":[{"l":"a","s":"b"}]}', 'UNKNOWN_VERSION'],
    ['extra top-level field', '{"v":1,"items":[{"l":"a","s":"b"}],"x":1}', 'MALFORMED'],
    ['extra item field', '{"v":1,"items":[{"l":"a","s":"b","t":1}]}', 'MALFORMED'],
    ['zero items', '{"v":1,"items":[]}', 'MALFORMED'],
    ['label too long', `{"v":1,"items":[{"l":"${'x'.repeat(65)}","s":"b"}]}`, 'MALFORMED'],
    ['non-string secret', '{"v":1,"items":[{"l":"a","s":5}]}', 'MALFORMED'],
    ['not json', 'abc', 'MALFORMED'],
    ['invalid utf-8', '�', 'MALFORMED'],
  ])('rejects %s', (_n, text, code) => {
    const bytes = text === '�' ? Uint8Array.of(0xff, 0xfe) : new TextEncoder().encode(text);
    expect(() => decodePayload(bytes)).toThrow(PayloadError);
    try {
      decodePayload(bytes);
    } catch (e) {
      expect((e as PayloadError).code).toBe(code);
    }
  });

  it('refuses to encode invalid items', () => {
    expect(() => encodePayload([])).toThrow(PayloadError);
    expect(() => encodePayload([{ label: 'x'.repeat(65), secret: 's' }])).toThrow(PayloadError);
  });

  it('matches the fixed examples in docs/payload-v1.md byte for byte', () => {
    const md = readFileSync(join(__dirname, '../../docs/payload-v1.md'), 'utf8');
    const blocks = [...md.matchAll(/<!-- example:(\w+) -->\n```json\n(.*)\n```\n\nHex: `([0-9a-f]+)`/g)];
    expect(blocks.length).toBe(3);
    for (const [, , json, hex] of blocks) {
      const items = decodePayload(new TextEncoder().encode(json!));
      const re = encodePayload(items);
      expect(dec.decode(re)).toBe(json);
      expect(Buffer.from(re).toString('hex')).toBe(hex);
    }
  });
});

/** vault-list-labels-archive 2.2: row summaries (design D5 and the display-time requirements). */
import { describe, expect, it } from 'vitest';
import { summarize, truncateLabel, visibleName } from '../../src/vault/summary';

const items = (labels: string[]) => labels.map((l) => ({ label: l, secret: 'SECRET-VALUE' }));

describe('summarize', () => {
  it('a named vault with 5 items and 3 keys: name, Active, 5 items, 3 labels, +2 more, 3 keys', () => {
    const s = summarize({ name: 'Work', archived: false, items: items(['A', 'B', 'C', 'D', 'E']), registry: 'v2', keyCount: 3 });
    expect(s).toEqual({ name: 'Work', status: 'active', count: 5, labels: ['A', 'B', 'C'], more: 2, keys: 3 });
  });

  it('never contains a secret value', () => {
    const s = summarize({ name: 'Work', archived: true, items: items(['A', 'B', 'C', 'D']), registry: 'v2', keyCount: 2 });
    expect(JSON.stringify(s)).not.toContain('SECRET-VALUE');
  });

  it('status: archived, and older test vault for VaultRegistry v1', () => {
    expect(summarize({ archived: true, items: [], registry: 'v2', keyCount: 2 }).status).toBe('archived');
    expect(summarize({ archived: false, items: items(['a']), registry: 'v1', keyCount: 2 }).status).toBe('older');
  });

  it('an unnamed vault has no name (the UI says "Unnamed vault")', () => {
    expect(summarize({ archived: false, items: items(['a']), registry: 'v2', keyCount: 2 }).name).toBeUndefined();
  });

  it('empty labels show as "Secret n"', () => {
    expect(summarize({ archived: false, items: items(['', 'x']), registry: 'v2', keyCount: 2 }).labels).toEqual(['Secret 1', 'x']);
  });
});

describe('truncateLabel: 24 code points, never splitting a surrogate pair', () => {
  it('keeps 24 characters as they are', () => {
    expect(truncateLabel('x'.repeat(24))).toBe('x'.repeat(24));
  });
  it('cuts the 25th and adds an ellipsis', () => {
    expect(truncateLabel('x'.repeat(25))).toBe('x'.repeat(24) + '…');
  });
  it('counts non-BMP characters as one and never leaves half a pair', () => {
    const out = truncateLabel('\u{1F511}'.repeat(30));
    expect([...out]).toHaveLength(25);
    expect(out.startsWith('\u{1F511}'.repeat(24))).toBe(true);
    expect(/[\ud800-\udfff]/u.test(out)).toBe(false);
  });
  it('a combining character counts as its own code point', () => {
    const s = 'e\u0301'.repeat(12) + 'z';
    expect(truncateLabel(s)).toBe('e\u0301'.repeat(12) + '…');
  });
});

describe('visibleName', () => {
  it.each([
    ['Family', 'Family'],
    ['  spaced  ', '  spaced  '],
    ['   ', undefined],
    ['\u200d\u200c', undefined],
    ['\u3164', undefined],
    ['\u0301', undefined],
    [undefined, undefined],
  ])('%j -> %j', (n, want) => {
    expect(visibleName(n)).toBe(want);
  });
});

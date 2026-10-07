/** vault-list-labels-archive 2.2: row summaries (design D5 and the display-time requirements). */
import { describe, expect, it } from 'vitest';
import { summarize, truncateLabel, visibleName } from '../../src/vault/summary';

const items = (labels: string[]) => labels.map((l) => ({ label: l, secret: 'SECRET-VALUE' }));

describe('summarize', () => {
  it('a named vault with 5 items and 3 keys: name, Active, 5 items, 3 labels, +2 more, 3 keys', () => {
    const s = summarize({ name: 'Work', archived: false, items: items(['A', 'B', 'C', 'D', 'E']), older: false, keyCount: 3 });
    expect(s).toEqual({ name: 'Work', status: 'active', count: 5, labels: ['A', 'B', 'C'], more: 2, keys: 3 });
  });

  it('never contains a secret value', () => {
    const s = summarize({ name: 'Work', archived: true, items: items(['A', 'B', 'C', 'D']), older: false, keyCount: 2 });
    expect(JSON.stringify(s)).not.toContain('SECRET-VALUE');
  });

  it('status: archived, and older test vault for VaultRegistry v1', () => {
    expect(summarize({ archived: true, items: [], older: false, keyCount: 2 }).status).toBe('archived');
    expect(summarize({ archived: false, items: items(['a']), older: true, keyCount: 2 }).status).toBe('older');
  });

  it('an unnamed vault has no name (the UI says "Unnamed vault")', () => {
    expect(summarize({ archived: false, items: items(['a']), older: false, keyCount: 2 }).name).toBeUndefined();
  });

  it('empty labels show as "Secret n"', () => {
    expect(summarize({ archived: false, items: items(['', 'x']), older: false, keyCount: 2 }).labels).toEqual(['Secret 1', 'x']);
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

describe('display-only cap on combining marks (review LOW)', () => {
  const marks = '\u0301'.repeat(50);
  it('a name keeps at most 3 combining marks in a row when shown', () => {
    expect(visibleName(`e${marks}x`)).toBe('e\u0301\u0301\u0301x');
  });
  it('labels in a row summary too', () => {
    expect(summarize({ archived: false, items: [{ label: `a${marks}`, secret: 's' }], older: false, keyCount: 2 }).labels).toEqual(['a\u0301\u0301\u0301']);
  });
  it('3 or fewer are left alone', () => {
    expect(visibleName('Cafe\u0301')).toBe('Cafe\u0301');
  });
});

describe('names and labels stay inside their row (review LOW, CSS)', () => {
  it('bdi and .vault-row clip and wrap', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(`${process.cwd()}/src/ui/global.css`, 'utf8').replace(/\s+/g, ' ');
    const rule = (sel: string) => {
      const at = css.indexOf(`${sel} {`);
      return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
    };
    for (const decl of ['max-width: 100%', 'overflow: hidden', 'overflow-wrap: anywhere']) {
      expect(rule('bdi')).toContain(decl);
      expect(rule('.vault-row')).toContain(decl);
    }
    expect(rule('bdi')).toContain('display: inline-block');
  });
});

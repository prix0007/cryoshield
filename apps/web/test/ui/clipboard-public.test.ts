import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIPBOARD_CLEAR_MS, copyPublic, copySecret } from '../../src/ui/clipboard';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('copyPublic (show-vault-onchain-location D4)', () => {
  it('a public value copied after a secret is not blanked by the secret’s pending clear', async () => {
    const writes: string[] = [];
    const clip = { writeText: vi.fn(async (t: string) => void writes.push(t)) };
    const onClear = vi.fn();
    await copySecret('seed words', clip, onClear);
    await copyPublic('0xvault', clip);
    // The secret is no longer on the clipboard; its chip is told the clear is done.
    expect(onClear).toHaveBeenCalledWith(true);
    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS + 1);
    expect(writes).toEqual(['seed words', '0xvault']);
  });

  it('keeps the pending secret clear if the public copy fails', async () => {
    const writes: string[] = [];
    const clip = { writeText: vi.fn(async (t: string) => void writes.push(t)) };
    await copySecret('seed words', clip);
    expect(await copyPublic('0xvault', { writeText: async () => Promise.reject(new Error('denied')) })).toBe(false);
    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS + 1);
    expect(writes).toEqual(['seed words', '']);
  });
});

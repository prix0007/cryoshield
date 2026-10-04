/** add-donation: the /support Copy button copies exactly the address shown, with a fallback; it never clears it. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { wireCopy } from '../../src/support/copy';

const ADDRESS = '0xfb4172e26AC8735C06656f1df14151cFe8441481';
function page() {
  document.body.innerHTML = `<code id="donation-address">${ADDRESS}</code><button id="copy-address" hidden>Copy address</button><p id="copy-status" role="status"></p>`;
  return { btn: document.getElementById('copy-address') as HTMLButtonElement, status: document.getElementById('copy-status')! };
}
afterEach(() => vi.useRealTimers());

describe('wireCopy', () => {
  it('reveals the button (progressive enhancement) and copies exactly the shown address', async () => {
    const { btn, status } = page();
    const writeText = vi.fn(async () => undefined);
    wireCopy(document, { writeText });
    expect(btn.hidden).toBe(false);
    btn.click();
    await vi.waitFor(() => expect(status.textContent).toBe('Address copied. Check it matches before you send.'));
    expect(writeText).toHaveBeenCalledWith(ADDRESS);
  });

  it('never clears the clipboard afterwards (the address is not secret)', async () => {
    vi.useFakeTimers();
    const { btn } = page();
    const writeText = vi.fn(async () => undefined);
    wireCopy(document, { writeText });
    btn.click();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('falls back to selecting the address and execCommand("copy") when the clipboard API fails', async () => {
    const { btn, status } = page();
    const exec = vi.fn(() => true);
    (document as unknown as { execCommand: typeof exec }).execCommand = exec;
    wireCopy(document, { writeText: async () => Promise.reject(new Error('denied')) });
    btn.click();
    await vi.waitFor(() => expect(status.textContent).toMatch(/copied/i));
    expect(exec).toHaveBeenCalledWith('copy');
    expect(String(document.getSelection())).toBe(ADDRESS);
  });

  it('if nothing can copy, leaves the address selected and says so', async () => {
    const { btn, status } = page();
    (document as unknown as { execCommand: () => boolean }).execCommand = () => false;
    wireCopy(document, undefined);
    btn.click();
    await vi.waitFor(() => expect(status.textContent).toBe('Couldn’t copy automatically. The address is selected: copy it with your keyboard.'));
    expect(String(document.getSelection())).toBe(ADDRESS);
  });
});

/**
 * /support Copy button (add-donation). Copies exactly the text of #donation-address (the build-rendered address).
 * The clipboard is never cleared: the address is public. No wallet calls, no network, no storage.
 */
type Clip = Pick<Clipboard, 'writeText'> | undefined;

function selectAddress(doc: Document, el: Element): void {
  const range = doc.createRange();
  range.selectNodeContents(el);
  const sel = doc.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

export function wireCopy(doc: Document, clip: Clip = globalThis.navigator?.clipboard): void {
  const btn = doc.getElementById('copy-address') as HTMLButtonElement | null;
  const addr = doc.getElementById('donation-address');
  const status = doc.getElementById('copy-status');
  if (!btn || !addr || !status) return;
  btn.hidden = false;
  btn.addEventListener('click', async () => {
    const text = addr.textContent ?? '';
    let ok = false;
    try {
      if (clip) {
        await clip.writeText(text);
        ok = true;
      }
    } catch {
      /* fall through to the selection fallback */
    }
    if (!ok) {
      selectAddress(doc, addr);
      try {
        ok = doc.execCommand('copy');
      } catch {
        ok = false;
      }
    }
    status.textContent = ok ? 'Address copied. Check it matches before you send.' : 'Couldn’t copy automatically. The address is selected: copy it with your keyboard.';
  });
}

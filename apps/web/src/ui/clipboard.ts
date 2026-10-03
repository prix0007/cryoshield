/**
 * Clipboard hygiene (spec vault-web-app "Clipboard hygiene"): copy, then try to overwrite after 30 s if the page
 * still has focus (browsers refuse clipboard writes from unfocused pages).
 */
export const CLIPBOARD_CLEAR_MS = 30_000;
let timer: ReturnType<typeof setTimeout> | undefined;

/** `onClearTimer` (presentation only) runs when the auto-clear timer fires, after the clear was attempted. */
export async function copySecret(
  text: string,
  clip: Pick<Clipboard, 'writeText'> | undefined = globalThis.navigator?.clipboard,
  onClearTimer?: () => void,
): Promise<boolean> {
  if (!clip) return false;
  try {
    await clip.writeText(text);
  } catch {
    return false;
  }
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    if (typeof document === 'undefined' || document.hasFocus()) void clip.writeText('').catch(() => undefined);
    try {
      onClearTimer?.();
    } catch {
      /* presentation only */
    }
  }, CLIPBOARD_CLEAR_MS);
  return true;
}

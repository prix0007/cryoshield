/**
 * Clipboard hygiene (spec vault-web-app "Clipboard hygiene"): copy, then try to overwrite after 30 s if the page
 * still has focus (browsers refuse clipboard writes from unfocused pages).
 */
export const CLIPBOARD_CLEAR_MS = 30_000;
let timer: ReturnType<typeof setTimeout> | undefined;

let clearListener: ((cleared: boolean) => void) | undefined;
/** Drops the presentation callback (e.g. on Lock), so nothing outlives the vault view. The clear timer still runs. */
export function forgetClearListener(): void {
  clearListener = undefined;
}

/**
 * `onClearTimer` (presentation only) runs when the auto-clear timer fires, after the clear was attempted, with whether
 * it was attempted (false when the page had lost focus, so the UI can say so honestly).
 */
export async function copySecret(
  text: string,
  clip: Pick<Clipboard, 'writeText'> | undefined = globalThis.navigator?.clipboard,
  onClearTimer?: (cleared: boolean) => void,
): Promise<boolean> {
  if (!clip) return false;
  try {
    await clip.writeText(text);
  } catch {
    return false;
  }
  if (timer) clearTimeout(timer);
  clearListener = onClearTimer;
  timer = setTimeout(() => {
    timer = undefined;
    const cleared = typeof document === 'undefined' || document.hasFocus();
    if (cleared) void clip.writeText('').catch(() => undefined);
    const listener = clearListener;
    clearListener = undefined;
    try {
      listener?.(cleared);
    } catch {
      /* presentation only */
    }
  }, CLIPBOARD_CLEAR_MS);
  return true;
}

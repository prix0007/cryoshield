/**
 * Auto-lock (spec vault-web-app "Secrets in memory only with auto-lock"):
 * 5 minutes without interaction (warning 30 s before, extendable), page hide, or hidden for over 60 s.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export const IDLE_MS = 5 * 60_000;
export const WARN_MS = 30_000;
export const HIDDEN_MS = 60_000;

export function useAutoLock(active: boolean, onLock: () => void) {
  const [warning, setWarning] = useState(false);
  const lockRef = useRef(onLock);
  lockRef.current = onLock;
  const timers = useRef<{ warn?: ReturnType<typeof setTimeout>; lock?: ReturnType<typeof setTimeout>; hidden?: ReturnType<typeof setTimeout> }>({});

  const clear = () => {
    clearTimeout(timers.current.warn);
    clearTimeout(timers.current.lock);
  };

  const reset = useCallback(() => {
    clear();
    setWarning(false);
    timers.current.warn = setTimeout(() => setWarning(true), IDLE_MS - WARN_MS);
    timers.current.lock = setTimeout(() => lockRef.current(), IDLE_MS);
  }, []);

  useEffect(() => {
    if (!active) {
      clear();
      setWarning(false);
      return;
    }
    reset();
    const t = timers.current;
    const activity = () => reset();
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, activity, { passive: true }));
    const onHide = () => lockRef.current();
    const onVisibility = () => {
      clearTimeout(timers.current.hidden);
      if (document.visibilityState === 'hidden') timers.current.hidden = setTimeout(() => lockRef.current(), HIDDEN_MS);
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clear();
      clearTimeout(t.hidden);
      events.forEach((e) => window.removeEventListener(e, activity));
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, reset]);

  return { warning, extend: reset };
}

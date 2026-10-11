import { useEffect, useState } from 'react';
import type { BuildState } from '../lib/build-check';

const MIN_INTERVAL_MS = 60_000;

/**
 * reload-on-new-build D5: true once the site serves a newer app build than this tab runs. Asks at start and when the tab
 * becomes visible again, at most once per minute, never on a timer. Informational only: writes check on their own (D2).
 */
export function useUpdateAvailable(check: () => Promise<BuildState>): boolean {
  const [outdated, setOutdated] = useState(false);
  useEffect(() => {
    if (outdated) return;
    let live = true;
    let last = -Infinity;
    const run = () => {
      const now = Date.now();
      if (now - last < MIN_INTERVAL_MS) return;
      last = now;
      check().then(
        (s) => live && s === 'outdated' && setOutdated(true),
        () => undefined, // unknown: say nothing
      );
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    run();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [check, outdated]);
  return outdated;
}

import { useEffect, useState } from 'react';
import type { ReleaseLabel } from '../lib/release';

/**
 * footer-release-version D4/D5: the footer's Version line, asked once from the release service after the app has
 * rendered (the service loads its chunk and fetches /release.json lazily). Null while unknown, on failure, and when
 * the service says null, so the footer shows nothing rather than a guess.
 */
export function useRelease(release: () => Promise<ReleaseLabel | null>): ReleaseLabel | null {
  const [label, setLabel] = useState<ReleaseLabel | null>(null);
  useEffect(() => {
    let live = true;
    release().then(
      (l) => {
        if (live && l) setLabel(l);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [release]);
  return label;
}

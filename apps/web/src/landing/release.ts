/**
 * footer-release-version D4: the landing footer's Version line, filled from /release.json once the page is up.
 * Progressive enhancement: the line is hidden in the HTML, and nothing here can throw into the page.
 *
 * D5: this is the landing page's own copy of the parsing and labelling in src/lib/release.ts (the landing page and
 * /app may not share a chunk, verify-build); test/landing/release.test.ts keeps the two in step.
 */
const REPO = 'https://github.com/prix0007/cryoshield';
const TAG_RE = /^v\d+\.\d+\.\d+(-[0-9A-Za-z][0-9A-Za-z.-]*)?$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const TIMEOUT_MS = 4000;

/** The line's text and link for a /release.json body, or null unless the body has the documented shape. */
export function labelFor(body: unknown): { text: string; href: string } | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const { commit, release } = body as Record<string, unknown>;
  if (typeof commit !== 'string' || !COMMIT_RE.test(commit)) return null;
  if (release === null) return { text: `dev ${commit.slice(0, 7)}`, href: `${REPO}/commit/${commit}` };
  if (typeof release !== 'string' || !TAG_RE.test(release)) return null;
  return { text: release, href: `${REPO}/releases/tag/${release}` };
}

/** Fills and shows the `[data-release]` line; leaves it hidden when the release is unknown. */
export async function wireRelease(doc: Document, fetchFn: typeof fetch, timeoutMs = TIMEOUT_MS): Promise<void> {
  const el = doc.querySelector<HTMLElement>('[data-release]');
  if (!el) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn('/release.json', { method: 'GET', cache: 'no-store', credentials: 'same-origin', signal: ctrl.signal });
    if (!res.ok) return;
    const label = labelFor(await res.json());
    if (!label) return;
    // Text and href only, from validated values: no markup ever reaches the DOM (Trusted Types stay untouched).
    const a = doc.createElement('a');
    a.href = label.href;
    a.rel = 'noopener noreferrer';
    a.textContent = label.text;
    el.replaceChildren(doc.createTextNode('Version '), a);
    el.hidden = false;
  } catch {
    /* unknown: the line stays hidden */
  } finally {
    clearTimeout(timer);
  }
}

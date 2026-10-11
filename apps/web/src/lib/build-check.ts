/**
 * Outdated-build check (reload-on-new-build). A tab keeps running the code it loaded; before any on-chain write the app
 * asks whether the server now serves a different build, so an old tab never writes with code older than the site's.
 *
 * Identity (D1): the page's `<script type="module" src>` paths. Content hashes cascade through the import graph, so the
 * entry name changes whenever any JavaScript the page can load changes. The served page is fetched from the same origin
 * (no cache, no query) and read with a regex, not DOMParser (a Trusted Types sink under our CSP); nothing reaches the
 * DOM. Only a definite difference is `outdated`; anything undecidable is `unknown` and never blocks a write (D3).
 */
import { WriteError } from '../account/errors';

export type BuildState = 'current' | 'outdated' | 'unknown';

export interface BuildCheckEnv {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** The running document. */
  doc: Document;
  /** The running page's URL (its path is fetched; query and fragment are dropped). */
  href: string;
  timeoutMs?: number;
}

const TIMEOUT_MS = 4000;
const SCRIPT_TAG = /<script\b([^>]*)>/gi;

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

/** Same-origin paths only, sorted: another origin can never be this app's entry. */
function normalise(srcs: readonly string[], base: string): string[] {
  const origin = new URL(base).origin;
  const out = new Set<string>();
  for (const s of srcs) {
    try {
      const u = new URL(s, base);
      if (u.origin === origin) out.add(u.pathname);
    } catch {
      /* not a URL: ignored */
    }
  }
  return [...out].sort();
}

/** Module entry script paths named in an HTML text. */
export function moduleScriptsInHtml(html: string, base: string): string[] {
  const srcs: string[] = [];
  for (const m of html.matchAll(SCRIPT_TAG)) {
    const attrs = m[1] ?? '';
    const src = attr(attrs, 'src');
    if (attr(attrs, 'type')?.toLowerCase() === 'module' && src) srcs.push(src);
  }
  return normalise(srcs, base);
}

function moduleScriptsInDocument(doc: Document, base: string): string[] {
  return normalise(
    [...doc.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')].map((s) => s.getAttribute('src') ?? ''),
    base,
  );
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export async function checkBuild(env: BuildCheckEnv = browserEnv()): Promise<BuildState> {
  const mine = moduleScriptsInDocument(env.doc, env.href);
  if (mine.length === 0) return 'unknown';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), env.timeoutMs ?? TIMEOUT_MS);
  try {
    const res = await env.fetch(new URL(env.href).pathname, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      signal: ctrl.signal,
    });
    if (!res.ok || !(res.headers.get('content-type') ?? '').toLowerCase().startsWith('text/html')) return 'unknown';
    const served = moduleScriptsInHtml(await res.text(), env.href);
    if (served.length === 0) return 'unknown';
    return sameList(mine, served) ? 'current' : 'outdated';
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timer);
  }
}

/** The only reload the app performs, always from a user's press of Reload page (D4, D6). */
export function reloadPage(): void {
  location.reload();
}

function browserEnv(): BuildCheckEnv {
  return { fetch: (u, i) => fetch(u, i), doc: document, href: location.href };
}

/**
 * Throws WriteError('OUTDATED') only when the check is sure the site serves another build. A missing or throwing check
 * lets the write through (fail open, D3).
 */
export async function assertCurrentBuild(check: (() => Promise<BuildState>) | undefined): Promise<void> {
  let state: BuildState = 'unknown';
  try {
    if (check) state = await check();
  } catch {
    state = 'unknown';
  }
  if (state === 'outdated') throw new WriteError('OUTDATED');
}

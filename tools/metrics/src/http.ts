// Bounded HTTP for untrusted endpoints (security review LOW-5/6/7): the body is streamed with a byte cap, the timeout
// covers the whole exchange including the body, and redirects are followed only to https URLs that `allowRedirect`
// accepts (never to another scheme or an arbitrary host). Messages that came from a remote end are cleaned before
// they reach a terminal or a CI log.

export class HttpError extends Error {
  override name = 'HttpError';
}

export interface Capped {
  status: number;
  ok: boolean;
  /** null when the body is larger than the cap. */
  body: Uint8Array | null;
}

export interface CappedOptions {
  cap: number;
  timeoutMs: number;
  allowRedirect?: (to: URL) => boolean;
  maxRedirects?: number;
}

async function readBody(res: Response, cap: number, signal: AbortSignal): Promise<Uint8Array | null> {
  const len = Number(res.headers.get('content-length') ?? '0');
  if (len > cap) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) {
    const b = new Uint8Array(await res.arrayBuffer());
    return b.length > cap ? null : b;
  }
  const reader = res.body.getReader();
  // the timeout covers the body too: a body that trickles in is cancelled, never returned as complete
  const onAbort = () => void reader.cancel().catch(() => {});
  signal.addEventListener('abort', onAbort, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (signal.aborted) throw new HttpError('timed out');
    if (done) break;
    total += value.length;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  signal.removeEventListener('abort', onAbort);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export async function fetchCapped(fetchFn: typeof fetch, url: string, init: RequestInit, opts: CappedOptions): Promise<Capped> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  try {
    let current = url;
    for (let hop = 0; ; hop++) {
      const res = await fetchFn(current, { ...init, signal: ctrl.signal, credentials: 'omit', redirect: 'manual' });
      if (res.status >= 300 && res.status < 400 && res.headers.has('location')) {
        await res.body?.cancel().catch(() => {});
        const to = new URL(res.headers.get('location') as string, current);
        if (hop >= (opts.maxRedirects ?? 0) || to.protocol !== 'https:' || !opts.allowRedirect?.(to)) {
          throw new HttpError(`redirect refused (HTTP ${res.status})`);
        }
        current = to.href;
        continue;
      }
      return { status: res.status, ok: res.ok, body: await readBody(res, opts.cap, ctrl.signal) };
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(ctrl.signal.aborted ? 'timed out' : `request failed: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** A remote-supplied message, safe for a terminal or a GitHub Actions log (no control characters, no "::" commands). */
export function clean(text: string, max = 200): string {
  const flat = text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
  const safe = flat.replace(/::/g, ': :');
  return safe.length > max ? `${safe.slice(0, max)}…` : safe;
}

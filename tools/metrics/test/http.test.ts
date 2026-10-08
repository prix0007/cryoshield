// Security review LOW-5/6/7: hostile endpoints cannot exhaust memory, hang the run, redirect requests elsewhere, or
// inject workflow commands into the log.
import { describe, expect, it } from 'vitest';
import { clean, fetchCapped, HttpError } from '../src/http.ts';
import { Rpc, RpcError } from '../src/rpc.ts';

const stream = (chunks: number, size: number, delayMs = 0) =>
  new ReadableStream<Uint8Array>({
    async pull(c) {
      if (chunks-- <= 0) return c.close();
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      c.enqueue(new Uint8Array(size));
    },
  });

describe('fetchCapped', () => {
  it('stops reading a body past the cap (streamed, no content-length)', async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(1024));
      },
    });
    const r = await fetchCapped((async () => new Response(body)) as typeof fetch, 'https://x.example', {}, { cap: 4096, timeoutMs: 1000 });
    expect(r.body).toBeNull();
    expect(pulled).toBeLessThan(10);
  });

  it('times out on a body that trickles in', async () => {
    const f = (async (_u: string, init?: RequestInit) => {
      const s = stream(1000, 1, 50);
      init?.signal?.addEventListener('abort', () => s.cancel().catch(() => {}));
      return new Response(s);
    }) as typeof fetch;
    await expect(fetchCapped(f, 'https://x.example', {}, { cap: 1 << 20, timeoutMs: 200 })).rejects.toBeInstanceOf(HttpError);
  });

  it('follows redirects only to https hosts the caller allows', async () => {
    const seen: string[] = [];
    const f = (async (u: string) => {
      seen.push(u);
      if (u === 'https://arweave.net/item') return new Response(null, { status: 302, headers: { location: 'https://abc.arweave.net/item' } });
      if (u === 'https://arweave.net/evil') return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } });
      if (u === 'https://arweave.net/other') return new Response(null, { status: 302, headers: { location: 'https://attacker.example/' } });
      return new Response('ok');
    }) as typeof fetch;
    const allow = (to: URL) => to.hostname === 'arweave.net' || to.hostname.endsWith('.arweave.net');
    const opts = { cap: 100, timeoutMs: 1000, allowRedirect: allow, maxRedirects: 3 };
    expect((await fetchCapped(f, 'https://arweave.net/item', {}, opts)).ok).toBe(true);
    await expect(fetchCapped(f, 'https://arweave.net/evil', {}, opts)).rejects.toThrow(/redirect refused/);
    await expect(fetchCapped(f, 'https://arweave.net/other', {}, opts)).rejects.toThrow(/redirect refused/);
    expect(seen).not.toContain('http://169.254.169.254/');
    expect(seen).not.toContain('https://attacker.example/');
  });

  it('RPC requests never follow redirects', async () => {
    const f = (async () => new Response(null, { status: 307, headers: { location: 'https://elsewhere.example/' } })) as typeof fetch;
    await expect(Rpc.connect(['https://rpc.example'], 1, f)).rejects.toThrow(/no usable RPC/);
  });

  it('cleans remote messages: no control characters, no workflow commands', () => {
    expect(clean('bad\n::error title=x::pwned\r\u001b[31m')).toBe('bad : :error title=x: :pwned [31m');
    expect(clean('x'.repeat(500)).length).toBeLessThanOrEqual(201);
  });

  it('RPC error text is cleaned before it is surfaced', async () => {
    const f = (async (_u: string, init?: RequestInit) => {
      const { id } = JSON.parse(String(init?.body));
      return Response.json({ jsonrpc: '2.0', id, error: { code: -1, message: 'boom\n::set-output name=x::y' } });
    }) as typeof fetch;
    const err = await Rpc.connect(['https://rpc.example'], 1, f).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect(String((err as Error).message)).not.toMatch(/\n|::/);
  });
});

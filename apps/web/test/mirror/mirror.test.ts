// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { mirrorTags, createMirror, MirrorError } from '../../src/mirror/mirror';

const vaultId = ('0x' + 'AB'.repeat(32)) as `0x${string}`;
const locs = [1, 2, 3].map((i) => ('0x' + i.toString(16).padStart(2, '0').repeat(32)) as `0x${string}`);

function parseItem(bytes: Uint8Array) {
  // sigType(2) sig(65) owner(65) target(1) anchor(1+32) nTags(8) nTagBytes(8)
  const owner = Buffer.from(bytes.slice(67, 132)).toString('hex');
  const nTags = Number(new DataView(bytes.buffer, bytes.byteOffset + 166, 8).getBigUint64(0, true));
  const nTagBytes = Number(new DataView(bytes.buffer, bytes.byteOffset + 174, 8).getBigUint64(0, true));
  return { owner, nTags, data: bytes.slice(182 + nTagBytes) };
}

describe('mirror tags (7.2)', () => {
  it('are exactly the recovery-tool D5 schema, lowercase 0x hex', () => {
    const t = mirrorTags({ vaultId, version: 2, locators: locs });
    expect(t).toEqual([
      { name: 'App-Name', value: 'CryoShield' },
      { name: 'CryoShield-Format', value: '1' },
      { name: 'CryoShield-Vault-Id', value: vaultId.toLowerCase() },
      { name: 'CryoShield-Version', value: '2' },
      ...locs.map((l) => ({ name: 'CryoShield-Locator', value: l })),
    ]);
    expect(t).toHaveLength(7);
    for (const x of t.filter((x) => x.name !== 'App-Name' && x.name !== 'CryoShield-Format' && x.name !== 'CryoShield-Version')) {
      expect(x.value).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });

  it('dedupes locators and refuses malformed ones', () => {
    expect(mirrorTags({ vaultId, version: 1, locators: [locs[0]!, locs[0]!.toUpperCase().replace('0X', '0x') as any] })).toHaveLength(5);
    expect(() => mirrorTags({ vaultId, version: 1, locators: ['0x12' as any] })).toThrow();
  });
});

describe('upload (7.3)', () => {
  it('posts a signed data item to <turbo>/v1/tx/ethereum with a per-session ephemeral signer; 8 locators + 1024 B < 8 KiB', async () => {
    const bodies: Uint8Array[] = [];
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://upload.example/v1/tx/ethereum');
      expect((init.headers as Record<string, string>)['content-type']).toBe('application/octet-stream');
      bodies.push(new Uint8Array(init.body as ArrayBuffer));
      return new Response(JSON.stringify({ id: 'x' }), { status: 200 });
    });
    const blob = new Uint8Array(1024).fill(0xa5);
    const eight = Array.from({ length: 8 }, (_, i) => ('0x' + (i + 1).toString(16).padStart(64, '0')) as `0x${string}`);
    const s1 = createMirror({ turboUploadUrl: 'https://upload.example', arweaveGatewayUrl: 'https://gw.example', fetchFn: fetchFn as any });
    await s1.upload({ vaultId, version: 1, locators: eight, blob });
    await s1.upload({ vaultId, version: 2, locators: eight, blob });
    const s2 = createMirror({ turboUploadUrl: 'https://upload.example', arweaveGatewayUrl: 'https://gw.example', fetchFn: fetchFn as any });
    await s2.upload({ vaultId, version: 3, locators: eight, blob });
    expect(bodies[0]!.length).toBeLessThan(8 * 1024);
    const [p1, p2, p3] = bodies.map(parseItem);
    expect(p1!.owner).toBe(p2!.owner);
    expect(p1!.owner).not.toBe(p3!.owner);
    expect(p1!.nTags).toBe(12);
    expect(Buffer.from(p1!.data)).toEqual(Buffer.from(blob));
  });

  it('maps HTTP failures (e.g. 402 free-tier exhausted) to MirrorError', async () => {
    const m = createMirror({ turboUploadUrl: 'https://upload.example', arweaveGatewayUrl: 'https://gw.example', fetchFn: (async () => new Response('', { status: 402 })) as any });
    await expect(m.upload({ vaultId, version: 1, locators: locs, blob: new Uint8Array(10) })).rejects.toBeInstanceOf(MirrorError);
  });
});

describe('self-heal (7.5)', () => {
  it('uploads only when no item for (vaultId, version) has byte-identical data', async () => {
    const blob = new Uint8Array([1, 2, 3]);
    let uploads = 0;
    const store: Record<string, Uint8Array> = { good: blob, junk: new Uint8Array([9]) };
    const fetchFn = async (url: string, init?: RequestInit) => {
      if (url.endsWith('/graphql')) {
        const q = JSON.parse(init!.body as string);
        expect(q.variables.tags).toEqual([
          { name: 'App-Name', values: ['CryoShield'] },
          { name: 'CryoShield-Vault-Id', values: [vaultId.toLowerCase()] },
          { name: 'CryoShield-Version', values: ['4'] },
        ]);
        const ids = Object.keys(store);
        return new Response(JSON.stringify({ data: { transactions: { edges: ids.map((id) => ({ node: { id, data: { size: String(store[id]!.length) } } })) } } }));
      }
      if (url.includes('/v1/tx/')) {
        uploads++;
        return new Response('{"id":"new"}');
      }
      const id = url.split('/').pop()!;
      return new Response(new Uint8Array(store[id] ?? new Uint8Array()));
    };
    const m = createMirror({ turboUploadUrl: 'https://u.example', arweaveGatewayUrl: 'https://gw.example', fetchFn: fetchFn as any });
    expect(await m.ensure({ vaultId, version: 4, locators: locs, blob })).toBe('present');
    delete store.good;
    expect(await m.ensure({ vaultId, version: 4, locators: locs, blob })).toBe('uploaded');
    expect(uploads).toBe(1);
  });

  it('skips items over 1024 bytes without fetching them', async () => {
    const fetched: string[] = [];
    const fetchFn = async (url: string) => {
      if (url.endsWith('/graphql')) return new Response(JSON.stringify({ data: { transactions: { edges: [{ node: { id: 'big', data: { size: '5000' } } }] } } }));
      if (url.includes('/v1/tx/')) return new Response('{"id":"n"}');
      fetched.push(url);
      return new Response(new Uint8Array(5000));
    };
    const m = createMirror({ turboUploadUrl: 'https://u.example', arweaveGatewayUrl: 'https://gw.example', fetchFn: fetchFn as any });
    expect(await m.ensure({ vaultId, version: 1, locators: locs, blob: new Uint8Array([1]) })).toBe('uploaded');
    expect(fetched).toEqual([]);
  });
});

describe('review fix 7: a gateway listing alone is never trusted', () => {
  const blob = new Uint8Array([1, 2, 3]);
  const listing = async () => new Response(JSON.stringify({ data: { transactions: { edges: [{ node: { id: 'x'.repeat(43), data: { size: '3' } } }] } } }));
  it.each([
    ['data fetch 404', async () => new Response('', { status: 404 })],
    ['different bytes', async () => new Response(new Uint8Array([1, 2, 4]))],
    ['oversized body without content-length', async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(2000)); c.close(); } }))],
    ['fetch throws', async () => { throw new Error('down'); }],
  ])('re-uploads when %s', async (_n, data) => {
    let uploads = 0;
    const fetchFn = async (url: string) => {
      if (url.endsWith('/graphql')) return listing();
      if (url.includes('/v1/tx/')) return (uploads++, new Response('{"id":"n"}'));
      return data();
    };
    const m = createMirror({ turboUploadUrl: 'https://u.example', arweaveGatewayUrl: 'https://gw.example', fetchFn: fetchFn as any });
    expect(await m.ensure({ vaultId, version: 1, locators: locs, blob })).toBe('uploaded');
    expect(uploads).toBe(1);
  });
  it('a 409/"already exists" upload response is not treated as success', async () => {
    const m = createMirror({ turboUploadUrl: 'https://u.example', arweaveGatewayUrl: 'https://gw.example', fetchFn: (async () => new Response('already exists', { status: 409 })) as any });
    await expect(m.upload({ vaultId, version: 1, locators: locs, blob })).rejects.toBeInstanceOf(MirrorError);
  });
});

describe('fix-arweave-mirror-status 1.1: copy found on either index', () => {
  const blob = new Uint8Array(300).fill(7);
  const FAST = 'https://fast.example';
  const GW = 'https://gw.example';
  const ID = 'A'.repeat(43);
  function server(over: { fastHas?: Uint8Array | null; gwHas?: Uint8Array | null; fastDown?: boolean } = {}) {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      calls.push(url);
      const host = url.startsWith(FAST) ? 'fast' : url.startsWith(GW) ? 'gw' : 'upload';
      if (host === 'upload') return new Response(JSON.stringify({ id: 'up' }), { status: 200 });
      if (host === 'fast' && over.fastDown) throw new TypeError('network');
      const has = host === 'fast' ? over.fastHas : over.gwHas;
      if (url.endsWith('/graphql')) {
        const edges = has ? [{ node: { id: ID, data: { size: String(has.length) } } }] : [];
        return new Response(JSON.stringify({ data: { transactions: { edges } } }), { status: 200 });
      }
      return has ? new Response(has.slice().buffer, { status: 200 }) : new Response('nf', { status: 404 });
    });
    const m = createMirror({ turboUploadUrl: 'https://upload.example', arweaveGatewayUrl: GW, fastIndexUrl: FAST, fetchFn: fetchFn as any });
    return { m, calls };
  }
  const input = { vaultId, version: 1, locators: [locs[0]!], blob };

  it('present (no upload) when arweave.net has nothing yet but the fast index serves identical bytes', async () => {
    const { m, calls } = server({ fastHas: blob, gwHas: null });
    expect(await m.ensure(input)).toBe('present');
    expect(calls.some((u) => u.includes('upload.example'))).toBe(false);
    expect(calls).toContain(`${FAST}/${ID}`); // data fetched from the host that listed it
  });

  it('uploads when the fast index serves different bytes and the gateway has nothing', async () => {
    const { m, calls } = server({ fastHas: new Uint8Array(300).fill(8), gwHas: null });
    expect(await m.ensure(input)).toBe('uploaded');
    expect(calls.some((u) => u.includes('upload.example/v1/tx/ethereum'))).toBe(true);
  });

  it('tolerates one index being down and still finds the copy on the other', async () => {
    const { m } = server({ fastDown: true, gwHas: blob });
    expect(await m.ensure(input)).toBe('present');
  });

  it('upload() reports the Turbo item id and MirrorError carries status and step', async () => {
    const ok = server({});
    expect(typeof (await ok.m.upload(input))).toBe('string');
    const fetchFn = vi.fn(async () => new Response('pay', { status: 402 }));
    const bad = createMirror({ turboUploadUrl: 'https://upload.example', arweaveGatewayUrl: GW, fastIndexUrl: FAST, fetchFn: fetchFn as any });
    const e = await bad.upload(input).catch((x) => x);
    expect(e).toBeInstanceOf(MirrorError);
    expect([e.code, e.status, e.step]).toEqual(['UPLOAD_FAILED', 402, 'upload']);
  });
});

// Arweave mirror coverage (task 2.1; spec "Arweave mirror coverage metric"). For each vault's LATEST on-chain version,
// look up items tagged App-Name=CryoShield, CryoShield-Vault-Id, CryoShield-Version on each configured gateway (the
// same GraphQL query as the web app's self-heal), re-check the tags client-side, download at most 1024 bytes, and
// count the vault only when keccak256(data) equals the on-chain blobHash. Gateways are untrusted: a lookup error is
// counted as lookup_failed, never as mirrored. Vault ids go only to the configured gateways, never to the report.
import { keccak256, type Hex } from 'viem';
import { MAX_BLOB } from './blob.ts';
import type { MirrorResult } from './report.ts';

export const DEFAULT_GATEWAYS = ['https://arweave.net', 'https://turbo-gateway.com'];
const MAX_GRAPHQL_BYTES = 256 * 1024;
const TIMEOUT_MS = 20_000;
const CONCURRENCY = 4;
const ITEM_ID = /^[A-Za-z0-9_-]{43}$/;

export interface MirrorTarget {
  vaultId: Hex;
  version: number;
  blobHash: Hex;
}

async function readCapped(res: Response, cap: number): Promise<Uint8Array | null> {
  const len = Number(res.headers.get('content-length') ?? '0');
  if (len > cap) return null;
  if (!res.body) {
    const b = new Uint8Array(await res.arrayBuffer());
    return b.length > cap ? null : b;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

async function timed(fetchFn: typeof fetch, url: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetchFn(url, { ...init, signal: ctrl.signal, credentials: 'omit', redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

interface Node {
  id: string;
  size: number;
  tags: Map<string, string[]>;
}

async function lookup(host: string, t: MirrorTarget, fetchFn: typeof fetch): Promise<Node[]> {
  const query = 'query($tags:[TagFilter!]){transactions(tags:$tags,first:50,sort:HEIGHT_DESC){edges{node{id data{size} tags{name value}}}}}';
  const variables = {
    tags: [
      { name: 'App-Name', values: ['CryoShield'] },
      { name: 'CryoShield-Vault-Id', values: [t.vaultId.toLowerCase()] },
      { name: 'CryoShield-Version', values: [String(t.version)] },
    ],
  };
  const res = await timed(fetchFn, `${host}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
  const body = await readCapped(res, MAX_GRAPHQL_BYTES);
  if (!body) throw new Error('GraphQL response too large');
  const json = JSON.parse(new TextDecoder().decode(body)) as {
    data?: { transactions?: { edges?: { node?: { id?: unknown; data?: { size?: unknown }; tags?: { name?: unknown; value?: unknown }[] } }[] } };
  };
  const edges = json.data?.transactions?.edges;
  if (!Array.isArray(edges)) throw new Error('GraphQL response has no transactions');
  return edges.map((e) => {
    const tags = new Map<string, string[]>();
    for (const tag of e.node?.tags ?? []) {
      const name = String(tag.name ?? '');
      tags.set(name, [...(tags.get(name) ?? []), String(tag.value ?? '')]);
    }
    return { id: String(e.node?.id ?? ''), size: Number(e.node?.data?.size ?? NaN), tags };
  });
}

const tagsMatch = (n: Node, t: MirrorTarget) =>
  n.tags.get('App-Name')?.includes('CryoShield') === true &&
  n.tags.get('CryoShield-Vault-Id')?.some((v) => v.toLowerCase() === t.vaultId.toLowerCase()) === true &&
  n.tags.get('CryoShield-Version')?.includes(String(t.version)) === true;

type Outcome = 'mirrored' | 'not_mirrored' | 'lookup_failed';

async function check(t: MirrorTarget, gateways: string[], fetchFn: typeof fetch): Promise<Outcome> {
  let anyLookup = false;
  for (const host of gateways) {
    let nodes: Node[];
    try {
      nodes = await lookup(host, t, fetchFn);
      anyLookup = true;
    } catch {
      continue;
    }
    for (const n of nodes) {
      if (!ITEM_ID.test(n.id) || !Number.isFinite(n.size) || n.size < 1 || n.size > MAX_BLOB || !tagsMatch(n, t)) continue;
      try {
        const res = await timed(fetchFn, `${host}/${n.id}`);
        if (!res.ok) continue;
        const data = await readCapped(res, MAX_BLOB);
        if (data && data.length > 0 && keccak256(data) === t.blobHash.toLowerCase()) return 'mirrored';
      } catch {
        /* try the next item */
      }
    }
  }
  return anyLookup ? 'not_mirrored' : 'lookup_failed';
}

export async function mirrorCoverage(targets: MirrorTarget[], gateways: string[], fetchFn: typeof fetch = fetch): Promise<MirrorResult> {
  const result: MirrorResult = { vaults: targets.length, mirrored: 0, not_mirrored: 0, lookup_failed: 0 };
  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const t = targets[next++] as MirrorTarget;
      result[await check(t, gateways, fetchFn)]++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
  return result;
}

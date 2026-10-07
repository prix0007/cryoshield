// Arweave mirror coverage (task 2.1; spec "Arweave mirror coverage metric"). For each vault's LATEST on-chain version,
// look up items tagged App-Name=CryoShield, CryoShield-Vault-Id, CryoShield-Version on each configured gateway (the
// same GraphQL query as the web app's self-heal), re-check the tags client-side, download at most 1024 bytes, and
// count the vault only when keccak256(data) equals the on-chain blobHash. Gateways are untrusted: a lookup error is
// counted as lookup_failed, never as mirrored. Vault ids go only to the configured gateways, never to the report.
import { keccak256, type Hex } from 'viem';
import { MAX_BLOB } from './blob.ts';
import { fetchCapped } from './http.ts';
import type { MirrorOutcome, MirrorResult } from './report.ts';

export const DEFAULT_GATEWAYS = ['https://arweave.net', 'https://turbo-gateway.com'];
const MAX_GRAPHQL_BYTES = 256 * 1024;
const TIMEOUT_MS = 20_000;
const CONCURRENCY = 4;
const ITEM_ID = /^[A-Za-z0-9_-]{43}$/;

export interface MirrorTarget {
  vaultId: Hex;
  version: number;
  blobHash: Hex;
  /** Count only items mined at or before this UNIX time (a frozen, cohort-level measure); none: any item. */
  deadline?: number;
}

/** Arweave serves item data from sandbox subdomains of the gateway: allow only https on the gateway or below it. */
function sameSite(host: string) {
  const base = new URL(host).hostname;
  return (to: URL) => to.hostname === base || to.hostname.endsWith(`.${base}`);
}

interface Node {
  id: string;
  size: number;
  minedAt: number | null;
  tags: Map<string, string[]>;
}

async function lookup(host: string, t: MirrorTarget, fetchFn: typeof fetch): Promise<Node[]> {
  const query = 'query($tags:[TagFilter!]){transactions(tags:$tags,first:50,sort:HEIGHT_DESC){edges{node{id data{size} tags{name value} block{timestamp}}}}}';
  const variables = {
    tags: [
      { name: 'App-Name', values: ['CryoShield'] },
      { name: 'CryoShield-Vault-Id', values: [t.vaultId.toLowerCase()] },
      { name: 'CryoShield-Version', values: [String(t.version)] },
    ],
  };
  const res = await fetchCapped(
    fetchFn,
    `${host}/graphql`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) },
    { cap: MAX_GRAPHQL_BYTES, timeoutMs: TIMEOUT_MS },
  );
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
  const body = res.body;
  if (!body) throw new Error('GraphQL response too large');
  const json = JSON.parse(new TextDecoder().decode(body)) as {
    data?: { transactions?: { edges?: { node?: { id?: unknown; data?: { size?: unknown }; tags?: { name?: unknown; value?: unknown }[]; block?: { timestamp?: unknown } | null } }[] } };
  };
  const edges = json.data?.transactions?.edges;
  if (!Array.isArray(edges)) throw new Error('GraphQL response has no transactions');
  return edges.map((e) => {
    const tags = new Map<string, string[]>();
    for (const tag of e.node?.tags ?? []) {
      const name = String(tag.name ?? '');
      tags.set(name, [...(tags.get(name) ?? []), String(tag.value ?? '')]);
    }
    const mined = Number(e.node?.block?.timestamp ?? NaN);
    return { id: String(e.node?.id ?? ''), size: Number(e.node?.data?.size ?? NaN), minedAt: Number.isFinite(mined) ? mined : null, tags };
  });
}

const tagsMatch = (n: Node, t: MirrorTarget) =>
  n.tags.get('App-Name')?.includes('CryoShield') === true &&
  n.tags.get('CryoShield-Vault-Id')?.some((v) => v.toLowerCase() === t.vaultId.toLowerCase()) === true &&
  n.tags.get('CryoShield-Version')?.includes(String(t.version)) === true;

async function check(t: MirrorTarget, gateways: string[], fetchFn: typeof fetch): Promise<MirrorOutcome> {
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
      if (t.deadline !== undefined && (n.minedAt === null || n.minedAt > t.deadline)) continue;
      try {
        const res = await fetchCapped(fetchFn, `${host}/${n.id}`, {}, { cap: MAX_BLOB, timeoutMs: TIMEOUT_MS, allowRedirect: sameSite(host), maxRedirects: 3 });
        const data = res.ok ? res.body : null;
        if (data && data.length > 0 && keccak256(data) === t.blobHash.toLowerCase()) return 'mirrored';
      } catch {
        /* try the next item */
      }
    }
  }
  return anyLookup ? 'not_mirrored' : 'lookup_failed';
}

/** One outcome per target, in order. */
export async function mirrorOutcomes(targets: MirrorTarget[], gateways: string[], fetchFn: typeof fetch = fetch): Promise<MirrorOutcome[]> {
  const out: MirrorOutcome[] = new Array(targets.length);
  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const i = next++;
      out[i] = await check(targets[i] as MirrorTarget, gateways, fetchFn);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
  return out;
}

export async function mirrorCoverage(targets: MirrorTarget[], gateways: string[], fetchFn: typeof fetch = fetch): Promise<MirrorResult> {
  const result: MirrorResult = { vaults: targets.length, mirrored: 0, not_mirrored: 0, lookup_failed: 0 };
  for (const o of await mirrorOutcomes(targets, gateways, fetchFn)) result[o]++;
  return result;
}

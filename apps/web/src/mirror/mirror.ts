/**
 * Arweave mirror via ArDrive Turbo (spec arweave-vault-mirror; tag schema = add-desktop-recovery-tool D5).
 * - upload(): signs an ANS-104 data item with a per-session in-memory key and POSTs it to Turbo;
 * - ensure(): self-heal on unlock: GraphQL by (Vault-Id, Version) on the fast-finality index (Turbo's gateway, which
 *   indexes items immediately) AND the configured gateway (arweave.net lists bundled items only after settlement);
 *   byte-compare data from the host that listed it (1024-byte cap); else upload (fix-arweave-mirror-status D1).
 * Everything on Arweave is untrusted: only the on-chain blob (or a blob that authenticates) is ever used.
 */
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { LocalAccount } from 'viem';
import { bytesEqual, randomBytes, type Hex } from '../lib/bytes';
import { buildDataItem, type Tag } from './ans104';

export class MirrorError extends Error {
  override name = 'MirrorError';
  constructor(
    readonly code: 'UPLOAD_FAILED' | 'LOOKUP_FAILED',
    readonly status?: number,
    readonly step: 'lookup' | 'upload' = code === 'LOOKUP_FAILED' ? 'lookup' : 'upload',
  ) {
    super(code);
  }
}

const HEX32 = /^0x[0-9a-f]{64}$/;
const MAX_BLOB = 1024;

export interface MirrorInput {
  vaultId: Hex;
  version: number;
  locators: readonly Hex[];
  blob: Uint8Array;
}

export function mirrorTags(p: { vaultId: Hex; version: number; locators: readonly Hex[] }): Tag[] {
  const id = p.vaultId.toLowerCase();
  if (!HEX32.test(id)) throw new Error('vaultId must be 32 bytes hex');
  if (!Number.isSafeInteger(p.version) || p.version < 1) throw new Error('version must be a positive integer');
  const locs = [...new Set(p.locators.map((l) => l.toLowerCase()))];
  if (locs.length === 0 || locs.length > 8 || !locs.every((l) => HEX32.test(l))) throw new Error('1-8 locators of 32 bytes required');
  return [
    { name: 'App-Name', value: 'CryoShield' },
    { name: 'CryoShield-Format', value: '1' },
    { name: 'CryoShield-Vault-Id', value: id },
    { name: 'CryoShield-Version', value: String(p.version) },
    ...locs.map((value) => ({ name: 'CryoShield-Locator', value })),
  ];
}

type FetchFn = typeof fetch;

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

export function createMirror(opts: { turboUploadUrl: string; arweaveGatewayUrl: string; fastIndexUrl?: string; fetchFn?: FetchFn }) {
  // Indexes to look in, fast-finality first (fix-arweave-mirror-status D1). Fixed by config, never taken from responses.
  const indexes = [...new Set([opts.fastIndexUrl, opts.arweaveGatewayUrl].filter((u): u is string => !!u))];
  const fetchFn: FetchFn = opts.fetchFn ?? ((...a) => fetch(...a));
  // Ephemeral per-session upload identity: random, in memory only, never derived from key material.
  let signer: LocalAccount | null = null;
  const session = () => (signer ??= privateKeyToAccount(generatePrivateKey()));

  async function upload(p: MirrorInput): Promise<string> {
    if (p.blob.length === 0 || p.blob.length > MAX_BLOB) throw new MirrorError('UPLOAD_FAILED');
    const item = await buildDataItem({ data: p.blob, tags: mirrorTags(p), anchor: randomBytes(32), account: session() });
    let res: Response;
    try {
      res = await fetchFn(`${opts.turboUploadUrl}/v1/tx/ethereum`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: item.bytes.slice().buffer,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
    } catch {
      throw new MirrorError('UPLOAD_FAILED');
    }
    if (!res.ok) throw new MirrorError('UPLOAD_FAILED', res.status);
    return item.id;
  }

  async function lookupOn(host: string, p: { vaultId: Hex; version: number }): Promise<{ id: string; size: number; host: string }[]> {
    const query = `query($tags:[TagFilter!]){transactions(tags:$tags,first:50,sort:HEIGHT_DESC){edges{node{id data{size}}}}}`;
    const variables = {
      tags: [
        { name: 'App-Name', values: ['CryoShield'] },
        { name: 'CryoShield-Vault-Id', values: [p.vaultId.toLowerCase()] },
        { name: 'CryoShield-Version', values: [String(p.version)] },
      ],
    };
    let res: Response;
    try {
      res = await fetchFn(`${host}/graphql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables }),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
    } catch {
      throw new MirrorError('LOOKUP_FAILED');
    }
    if (!res.ok) throw new MirrorError('LOOKUP_FAILED', res.status);
    const body = (await readCapped(res, 256 * 1024)) ?? new Uint8Array();
    let json: { data?: { transactions?: { edges?: { node?: { id?: unknown; data?: { size?: unknown } } }[] } } };
    try {
      json = JSON.parse(new TextDecoder().decode(body));
    } catch {
      throw new MirrorError('LOOKUP_FAILED');
    }
    return (json.data?.transactions?.edges ?? [])
      .map((e) => ({ id: String(e.node?.id ?? ''), size: Number(e.node?.data?.size ?? NaN), host }))
      .filter((n) => /^[A-Za-z0-9_-]{43}$|^[A-Za-z0-9_-]{1,64}$/.test(n.id) && Number.isFinite(n.size));
  }

  /** Items for (vaultId, version) on every index; throws LOOKUP_FAILED only if every index failed. */
  async function lookup(p: { vaultId: Hex; version: number }): Promise<{ id: string; size: number; host: string }[]> {
    const out: { id: string; size: number; host: string }[] = [];
    let lastError: MirrorError | undefined;
    let anyOk = false;
    for (const host of indexes) {
      try {
        out.push(...(await lookupOn(host, p)));
        anyOk = true;
      } catch (e) {
        lastError = e instanceof MirrorError ? e : new MirrorError('LOOKUP_FAILED');
      }
    }
    if (!anyOk && lastError) throw lastError;
    return out;
  }

  /**
   * Self-heal: 'present' if some item for (vaultId, version) has exactly these bytes, else uploads ('uploaded'). `id` is
   * that byte-verified item, or the fresh upload (show-vault-onchain-location D2).
   */
  async function ensure(p: MirrorInput): Promise<{ state: 'present' | 'uploaded'; id: string }> {
    let nodes: { id: string; size: number; host: string }[] = [];
    try {
      nodes = await lookup(p);
    } catch {
      nodes = []; // gateway down: upload anyway (free tier, tiny item)
    }
    for (const n of nodes) {
      if (n.size !== p.blob.length || n.size > MAX_BLOB) continue;
      try {
        const res = await fetchFn(`${n.host}/${n.id}`, { credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!res.ok) continue;
        const data = await readCapped(res, MAX_BLOB);
        if (data && bytesEqual(data, p.blob)) return { state: 'present', id: n.id };
      } catch {
        /* try next */
      }
    }
    return { state: 'uploaded', id: await upload(p) };
  }

  return { upload, ensure, lookup };
}

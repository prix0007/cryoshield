/**
 * Minimal ANS-104 data item builder with an Ethereum (type 3) signature, for uploads to ArDrive Turbo.
 * This signs an *upload*, not vault data: the signer is a throwaway in-memory key (spec arweave-vault-mirror
 * "Ephemeral upload identity"). Byte-for-byte cross-checked against @dha-team/arbundles in unit tests.
 * We avoid @ardrive/turbo-sdk in the browser bundle: it pulls ethers, @solana/web3.js, axios and arweave-js
 * (design D8), a large supply-chain surface for one POST.
 */
import type { LocalAccount } from 'viem';
import { hexToBytes } from 'viem';

export interface Tag {
  name: string;
  value: string;
}

const enc = new TextEncoder();
const SIG_TYPE_ETHEREUM = 3;

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function sha384(b: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-384', new Uint8Array(b)));
}

type DeepHashChunk = Uint8Array | DeepHashChunk[];

export async function deepHash(data: DeepHashChunk): Promise<Uint8Array> {
  if (Array.isArray(data)) {
    let acc = await sha384(concat(enc.encode('list'), enc.encode(String(data.length))));
    for (const chunk of data) acc = await sha384(concat(acc, await deepHash(chunk)));
    return acc;
  }
  const tag = concat(enc.encode('blob'), enc.encode(String(data.byteLength)));
  return sha384(concat(await sha384(tag), await sha384(data)));
}

/** Avro zig-zag varint long. */
function avroLong(n: number): Uint8Array {
  let z = n >= 0 ? n * 2 : -n * 2 - 1;
  const out: number[] = [];
  do {
    let b = z % 128;
    z = Math.floor(z / 128);
    if (z > 0) b |= 0x80;
    out.push(b);
  } while (z > 0);
  return Uint8Array.from(out);
}

export function serializeTags(tags: readonly Tag[]): Uint8Array {
  if (tags.length === 0) return new Uint8Array();
  const parts: Uint8Array[] = [avroLong(tags.length)];
  for (const t of tags) {
    const n = enc.encode(t.name);
    const v = enc.encode(t.value);
    parts.push(avroLong(n.length), n, avroLong(v.length), v);
  }
  parts.push(avroLong(0));
  return concat(...parts);
}

function u64le(n: number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
}

function b64url(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function buildDataItem(p: { data: Uint8Array; tags: readonly Tag[]; anchor: Uint8Array; account: LocalAccount }) {
  if (p.anchor.length !== 32) throw new Error('anchor must be 32 bytes');
  if (!p.account.publicKey) throw new Error('signer has no public key');
  const owner = hexToBytes(p.account.publicKey); // 65-byte uncompressed secp256k1 key
  if (owner.length !== 65) throw new Error('unexpected owner length');
  const rawTags = serializeTags(p.tags);
  const message = await deepHash([
    enc.encode('dataitem'),
    enc.encode('1'),
    enc.encode(String(SIG_TYPE_ETHEREUM)),
    owner,
    new Uint8Array(),
    p.anchor,
    rawTags,
    p.data,
  ]);
  const signature = hexToBytes(await p.account.signMessage({ message: { raw: message } }));
  if (signature.length !== 65) throw new Error('unexpected signature length');
  const sigType = Uint8Array.of(SIG_TYPE_ETHEREUM & 0xff, SIG_TYPE_ETHEREUM >> 8);
  const bytes = concat(
    sigType,
    signature,
    owner,
    Uint8Array.of(0), // no target
    Uint8Array.of(1),
    p.anchor,
    u64le(p.tags.length),
    u64le(rawTags.length),
    rawTags,
    p.data,
  );
  const id = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(signature))));
  return { id, bytes };
}

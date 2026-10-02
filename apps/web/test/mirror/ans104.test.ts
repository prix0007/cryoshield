// @vitest-environment node
/**
 * ANS-104 data items, cross-checked against a reference vector produced by @dha-team/arbundles@1.0.4
 * (test/fixtures/ans104-arbundles-vector.json; arbundles' own isValid() was true when it was generated).
 * The vector replaces the arbundles devDependency (its transitive elliptic/secp256k1/ws advisories) with the same
 * assurance: our builder must reproduce the reference bytes and id exactly. Signing is RFC 6979 deterministic.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bytesToHex, hexToBytes, recoverMessageAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { buildDataItem, deepHash, serializeTags } from '../../src/mirror/ans104';

const vector = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'ans104-arbundles-vector.json'), 'utf8')) as {
  input: { privateKey: `0x${string}`; tags: { name: string; value: string }[]; dataHex: string; anchorHex: string };
  expected: { id: string; rawHex: string };
};
const data = hexToBytes(`0x${vector.input.dataHex}`);
const anchor = hexToBytes(`0x${vector.input.anchorHex}`);
const account = privateKeyToAccount(vector.input.privateKey);

describe('ANS-104 data items (reference vector from @dha-team/arbundles)', () => {
  it('produces byte-identical signed data items and ids', async () => {
    const mine = await buildDataItem({ data, tags: vector.input.tags, anchor, account });
    expect(Buffer.from(mine.bytes).toString('hex')).toBe(vector.expected.rawHex);
    expect(mine.id).toBe(vector.expected.id);
  });

  it('the reference item is self-consistent: id = sha256(signature), signature recovers to the owner', async () => {
    const raw = hexToBytes(`0x${vector.expected.rawHex}`);
    expect(raw[0]! | (raw[1]! << 8)).toBe(3); // signature type 3 = Ethereum
    const signature = raw.slice(2, 67);
    const owner = raw.slice(67, 132);
    expect(createHash('sha256').update(signature).digest('base64url')).toBe(vector.expected.id);
    const enc = new TextEncoder();
    const message = await deepHash([enc.encode('dataitem'), enc.encode('1'), enc.encode('3'), owner, new Uint8Array(), anchor, serializeTags(vector.input.tags), data]);
    const signer = await recoverMessageAddress({ message: { raw: message }, signature: bytesToHex(signature) });
    expect(signer).toBe(account.address);
  });

  it('deepHash of an empty list is sha384(sha384("list0"))-style stable', async () => {
    const h = await deepHash([]);
    expect(h.length).toBe(48);
  });
});

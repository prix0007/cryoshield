// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { createData } from '@dha-team/arbundles/build/node/esm/src/ar-data-create';
import EthereumSigner from '@dha-team/arbundles/build/node/esm/src/signing/chains/ethereumSigner';
import { buildDataItem, deepHash } from '../../src/mirror/ans104';

const PK = ('0x' + '42'.repeat(32)) as `0x${string}`;

describe('ANS-104 data items (cross-checked against @dha-team/arbundles)', () => {
  it('produces byte-identical signed data items and ids', async () => {
    const tags = [
      { name: 'App-Name', value: 'CryoShield' },
      { name: 'CryoShield-Locator', value: '0x' + 'ab'.repeat(32) },
    ];
    const data = new Uint8Array(300).map((_, i) => i & 0xff);
    const anchor = new Uint8Array(32).fill(7);
    const mine = await buildDataItem({ data, tags, anchor, account: privateKeyToAccount(PK) });

    const signer = new EthereumSigner(PK.slice(2));
    const theirs = createData(Buffer.from(data), signer, { tags, anchor: Buffer.from(anchor).toString('base64url') === '' ? undefined : Buffer.from(anchor) as any });
    await theirs.sign(signer);
    expect(Buffer.from(mine.bytes).toString('hex')).toBe(Buffer.from(theirs.getRaw()).toString('hex'));
    expect(mine.id).toBe(theirs.id);
    expect(await theirs.isValid()).toBe(true);
  });

  it('deepHash of an empty list is sha384(sha384("list0"))-style stable', async () => {
    const h = await deepHash([]);
    expect(h.length).toBe(48);
  });
});

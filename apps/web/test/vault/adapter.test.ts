import { describe, expect, it } from 'vitest';
import vectors from '@cryoshield/vault-crypto/test-vectors/v1.json';
import { decodeVault, maxPayloadBytes } from '@cryoshield/vault-crypto';
import { addKeyToBlob, capacity, createVaultBlob, editVaultBlob, matchCandidates } from '../../src/vault/adapter';
import { decodePayload } from '../../src/vault/payload';
import { fromHex } from '../../src/lib/bytes';

const rand = () => crypto.getRandomValues(new Uint8Array(32));
const id = (n: number) => new Uint8Array(48).fill(n);
const vid = (n: number) => ('0x' + n.toString(16).padStart(2, '0').repeat(32)) as `0x${string}`;
const OWNER = '0x0000000000000000000000000000000000000001' as const;
const items = [{ label: 'Seed', secret: 'abandon art' }];

describe('vault adapter (4.2, bound to vaultId)', () => {
  it('creates a 2-key vault bound to its vaultId that either key opens; all PRF buffers are wiped', async () => {
    const a = rand(), b = rand();
    const aCopy = a.slice(), bCopy = b.slice();
    const { blob, locators } = await createVaultBlob({ vaultId: vid(1), rpId: 'localhost', keys: [{ credId: id(1), prf: a }, { credId: id(2), prf: b }], items });
    expect(locators).toHaveLength(2);
    expect(a.every((x) => x === 0) && b.every((x) => x === 0)).toBe(true);
    for (const [prf, idx] of [[aCopy, 0], [bCopy, 1]] as const) {
      const p = prf.slice();
      const m = await matchCandidates([{ vaultId: vid(1), blob, owner: OWNER, version: 1 }], p, id(idx + 1));
      expect(m).toHaveLength(1);
      expect(decodePayload(m[0]!.secret)).toEqual(items);
      expect(m[0]!.entryIndex).toBe(idx);
      expect(p.every((x) => x === 0)).toBe(true);
    }
  });

  it('10.7: a clone of the blob under another vaultId is NOT matched', async () => {
    const a = rand();
    const { blob } = await createVaultBlob({ vaultId: vid(1), rpId: 'localhost', keys: [{ credId: id(1), prf: a.slice() }, { credId: id(2), prf: rand() }], items });
    const m = await matchCandidates(
      [
        { vaultId: vid(1), blob, owner: OWNER, version: 1 },
        { vaultId: vid(9), blob, owner: '0x00000000000000000000000000000000000000ee', version: 1 }, // attacker clone
      ],
      a,
      id(1),
    );
    expect(m.map((x) => x.candidate.vaultId)).toEqual([vid(1)]);
  });

  it('10.7: identical (vaultId, blob) candidates collapse to one', async () => {
    const a = rand();
    const { blob } = await createVaultBlob({ vaultId: vid(1), rpId: 'localhost', keys: [{ credId: id(1), prf: a.slice() }, { credId: id(2), prf: rand() }], items });
    const c = { vaultId: vid(1), blob, owner: OWNER, version: 1 };
    expect(await matchCandidates([c, { ...c, blob: blob.slice() }], a, id(1))).toHaveLength(1);
  });

  it('returns every genuine vault for one key (several real vaults) and skips junk', async () => {
    const a = rand();
    const v1 = await createVaultBlob({ vaultId: vid(1), rpId: 'localhost', keys: [{ credId: id(1), prf: a.slice() }, { credId: id(2), prf: rand() }], items });
    const v2 = await createVaultBlob({ vaultId: vid(3), rpId: 'localhost', keys: [{ credId: id(1), prf: a.slice() }, { credId: id(3), prf: rand() }], items });
    const m = await matchCandidates(
      [
        { vaultId: vid(1), blob: v1.blob, owner: OWNER, version: 1 },
        { vaultId: vid(2), blob: new Uint8Array(200).fill(0x43), owner: OWNER, version: 1 },
        { vaultId: vid(3), blob: v2.blob, owner: OWNER, version: 1 },
      ],
      a,
      id(1),
    );
    expect(m.map((x) => x.candidate.vaultId)).toEqual([vid(1), vid(3)]);
  });

  it('refuses a zero vaultId', async () => {
    await expect(createVaultBlob({ vaultId: ('0x' + '00'.repeat(32)) as `0x${string}`, rpId: 'localhost', keys: [{ credId: id(1), prf: rand() }, { credId: id(2), prf: rand() }], items })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('passes the vault-crypto squatted-locator vector', async () => {
    const c = vectors.selectCases.find((x) => x.name === 'squatted-locator')! as any;
    const cands = c.candidates.map((cand: any, i: number) => ({ vaultId: ('0x' + (cand.vaultId ?? '')) as `0x${string}`, blob: fromHex(cand.blob ?? cand), owner: OWNER, version: 1, i }));
    const m = await matchCandidates(cands, fromHex(c.prf), undefined);
    expect(m[0]!.candidate).toBe(cands[c.expectedIndex]);
    expect(Buffer.from(m[0]!.secret).toString('hex')).toBe(c.expectedSecret);
  });

  it('edits and adds a key with one key, both bound to the vaultId', async () => {
    const a = rand(), b = rand(), c = rand();
    const aC = a.slice(), bC = b.slice(), cC = c.slice();
    const { blob } = await createVaultBlob({ vaultId: vid(1), rpId: 'localhost', keys: [{ credId: id(1), prf: a }, { credId: id(2), prf: b }], items });
    await expect(editVaultBlob(blob, aC.slice(), vid(2), items)).rejects.toBeTruthy(); // wrong vaultId cannot edit
    const edited = await editVaultBlob(blob, aC.slice(), vid(1), [...items, { label: 'Email', secret: 'x' }]);
    const added = await addKeyToBlob(edited, bC.slice(), vid(1), { credId: id(3), prf: cC.slice() });
    expect(decodeVault(added.blob).keyCount).toBe(3);
    const m = await matchCandidates([{ vaultId: vid(1), blob: added.blob, owner: OWNER, version: 3 }], cC, id(3));
    expect(decodePayload(m[0]!.secret)).toHaveLength(2);
    expect(m[0]!.entryIndex).toBe(2);
  });
});

describe('capacity (4.3)', () => {
  it('remaining = maxPayloadBytes - encoded length; negative blocks saving', () => {
    const ids = [id(1), id(2)];
    const max = maxPayloadBytes('localhost', ids, 1);
    const c = capacity('localhost', ids, items);
    expect(c.max).toBe(max);
    expect(c.remaining).toBe(max - c.used);
    expect(c.fits).toBe(true);
    const big = capacity('localhost', ids, [{ label: 'x', secret: 'y'.repeat(max) }]);
    expect(big.fits).toBe(false);
  });
});

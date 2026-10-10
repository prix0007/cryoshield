import { describe, expect, it } from 'vitest';
import vectors from '@cryoshield/vault-crypto/test-vectors/v1.json';
import { decodeVault, maxPayloadBytes } from '@cryoshield/vault-crypto';
import { addKeyToBlob, capacity, createVaultBlob, editVaultBlob, matchCandidates } from '../../src/vault/adapter';
import { clearVaultBlob } from '../../src/ui/vault-meta';
import { decodePayload, decodeVaultPayload, encodePayload, withItems } from '../../src/vault/payload';
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
    const { blob, locators } = await createVaultBlob({ vaultId: vid(1), rpId: 'localhost', keys: [{ credId: id(1), prf: a }, { credId: id(2), prf: b }], payload: { archived: false, items } });
    expect(locators).toHaveLength(2);
    expect(a.every((x) => x === 0) && b.every((x) => x === 0)).toBe(true);
    for (const [prf, idx] of [[aCopy, 0], [bCopy, 1]] as const) {
      const p = prf.slice();
      const m = await matchCandidates([{ vaultId: vid(1), blob, owner: OWNER, version: 1, registry: 'v2' as const }], p, id(idx + 1));
      expect(m).toHaveLength(1);
      expect(decodePayload(m[0]!.secret)).toEqual(items);
      expect(m[0]!.entryIndex).toBe(idx);
      expect(p.every((x) => x === 0)).toBe(true);
    }
  });

  it('10.7: a clone of the blob under another vaultId is NOT matched', async () => {
    const a = rand();
    const { blob } = await createVaultBlob({ vaultId: vid(1), rpId: 'localhost', keys: [{ credId: id(1), prf: a.slice() }, { credId: id(2), prf: rand() }], payload: { archived: false, items } });
    const m = await matchCandidates(
      [
        { vaultId: vid(1), blob, owner: OWNER, version: 1, registry: 'v2' as const },
        { vaultId: vid(9), blob, owner: '0x00000000000000000000000000000000000000ee', version: 1, registry: 'v2' as const }, // attacker clone
      ],
      a,
      id(1),
    );
    expect(m.map((x) => x.candidate.vaultId)).toEqual([vid(1)]);
  });

  it('10.7: identical (vaultId, blob) candidates collapse to one', async () => {
    const a = rand();
    const { blob } = await createVaultBlob({ vaultId: vid(1), rpId: 'localhost', keys: [{ credId: id(1), prf: a.slice() }, { credId: id(2), prf: rand() }], payload: { archived: false, items } });
    const c = { vaultId: vid(1), blob, owner: OWNER, version: 1, registry: 'v2' as const };
    expect(await matchCandidates([c, { ...c, blob: blob.slice() }], a, id(1))).toHaveLength(1);
  });

  it('returns every genuine vault for one key (several real vaults) and skips junk', async () => {
    const a = rand();
    const v1 = await createVaultBlob({ vaultId: vid(1), rpId: 'localhost', keys: [{ credId: id(1), prf: a.slice() }, { credId: id(2), prf: rand() }], payload: { archived: false, items } });
    const v2 = await createVaultBlob({ vaultId: vid(3), rpId: 'localhost', keys: [{ credId: id(1), prf: a.slice() }, { credId: id(3), prf: rand() }], payload: { archived: false, items } });
    const m = await matchCandidates(
      [
        { vaultId: vid(1), blob: v1.blob, owner: OWNER, version: 1, registry: 'v2' as const },
        { vaultId: vid(2), blob: new Uint8Array(200).fill(0x43), owner: OWNER, version: 1, registry: 'v2' as const },
        { vaultId: vid(3), blob: v2.blob, owner: OWNER, version: 1, registry: 'v2' as const },
      ],
      a,
      id(1),
    );
    expect(m.map((x) => x.candidate.vaultId)).toEqual([vid(1), vid(3)]);
  });

  it('refuses a zero vaultId', async () => {
    await expect(createVaultBlob({ vaultId: ('0x' + '00'.repeat(32)) as `0x${string}`, rpId: 'localhost', keys: [{ credId: id(1), prf: rand() }, { credId: id(2), prf: rand() }], payload: { archived: false, items } })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('passes the vault-crypto squatted-locator vector', async () => {
    const c = vectors.selectCases.find((x) => x.name === 'squatted-locator')! as any;
    const cands = c.candidates.map((cand: any, i: number) => ({ vaultId: ('0x' + (cand.vaultId ?? '')) as `0x${string}`, blob: fromHex(cand.blob ?? cand), owner: OWNER, version: 1, registry: 'v2' as const, i }));
    const m = await matchCandidates(cands, fromHex(c.prf), undefined);
    expect(m[0]!.candidate).toBe(cands[c.expectedIndex]);
    expect(Buffer.from(m[0]!.secret).toString('hex')).toBe(c.expectedSecret);
  });

  it('edits and adds a key with one key, both bound to the vaultId', async () => {
    const a = rand(), b = rand(), c = rand();
    const aC = a.slice(), bC = b.slice(), cC = c.slice();
    const { blob } = await createVaultBlob({ vaultId: vid(1), rpId: 'localhost', keys: [{ credId: id(1), prf: a }, { credId: id(2), prf: b }], payload: { archived: false, items } });
    await expect(editVaultBlob(blob, aC.slice(), vid(2), { archived: false, items })).rejects.toBeTruthy(); // wrong vaultId cannot edit
    const edited = await editVaultBlob(blob, aC.slice(), vid(1), { archived: false, items: [...items, { label: 'Email', secret: 'x' }] });
    const added = await addKeyToBlob(edited, bC.slice(), vid(1), { credId: id(3), prf: cC.slice() });
    expect(decodeVault(added.blob).keyCount).toBe(3);
    const m = await matchCandidates([{ vaultId: vid(1), blob: added.blob, owner: OWNER, version: 3, registry: 'v2' as const }], cC, id(3));
    expect(decodePayload(m[0]!.secret)).toHaveLength(2);
    expect(m[0]!.entryIndex).toBe(2);
  });
});

describe('capacity (4.3)', () => {
  it('remaining = maxPayloadBytes - encoded length; negative blocks saving', () => {
    const ids = [id(1), id(2)];
    const max = maxPayloadBytes('localhost', ids, 1);
    const c = capacity('localhost', ids, { archived: false, items });
    expect(c.max).toBe(max);
    expect(c.remaining).toBe(max - c.used);
    expect(c.fits).toBe(true);
    const big = capacity('localhost', ids, { archived: false, items: [{ label: 'x', secret: 'y'.repeat(max) }] });
    expect(big.fits).toBe(false);
  });

  it('D11: reserves the 9 bytes of "a":true, while active, and counts the name', () => {
    const ids = [id(1), id(2)];
    const plain = capacity('localhost', ids, { archived: false, items });
    expect(plain.used).toBe(encodePayload(items).length + 9);
    const archived = capacity('localhost', ids, { archived: true, items });
    expect(archived.used).toBe(encodePayload(items).length + 9); // the flag is now written instead of reserved
    const named = capacity('localhost', ids, { name: 'Family', archived: false, items });
    expect(named.used).toBe(plain.used + ',"n":"Family"'.length);
  });

  it('an invalid name does not fit', () => {
    expect(capacity('localhost', [id(1), id(2)], { name: '', archived: false, items }).fits).toBe(false);
  });
});

describe('editVaultBlob takes the whole payload (2.1)', () => {
  it('keeps the name and the archived flag', async () => {
    const a = rand();
    const aC = a.slice();
    const { blob } = await createVaultBlob({ vaultId: vid(1), rpId: 'localhost', keys: [{ credId: id(1), prf: a }, { credId: id(2), prf: rand() }], payload: { name: 'Family', archived: true, items } });
    const edited = await editVaultBlob(blob, aC.slice(), vid(1), withItems({ name: 'Family', archived: true, items }, [{ label: 'New', secret: 'n' }]));
    const m = await matchCandidates([{ vaultId: vid(1), blob: edited, owner: OWNER, version: 2, registry: 'v2' }], aC.slice(), undefined);
    expect(decodeVaultPayload(m[0]!.secret)).toMatchObject({ version: 2, name: 'Family', archived: true, items: [{ label: 'New', secret: 'n' }] });
  });

  it('clearVaultBlob keeps the blob length and the name', async () => {
    const a = rand();
    const aC = a.slice();
    const many = [{ label: 'One', secret: 'x'.repeat(100) }, { label: 'Two', secret: 'y'.repeat(50) }];
    const { blob } = await createVaultBlob({ vaultId: vid(1), rpId: 'localhost', keys: [{ credId: id(1), prf: a }, { credId: id(2), prf: rand() }], payload: { name: 'Family', archived: false, items: many } });
    const cleared = await clearVaultBlob(blob, aC.slice(), vid(1));
    expect(cleared.blob.length).toBe(blob.length);
    expect(cleared.payload).toMatchObject({ name: 'Family', archived: true, items: [] });
    const m = await matchCandidates([{ vaultId: vid(1), blob: cleared.blob, owner: OWNER, version: 2, registry: 'v2' }], aC.slice(), undefined);
    expect(decodeVaultPayload(m[0]!.secret).pad).toBe(cleared.payload.pad);
  });
});

/** pad-to-max-payload 3.1: every web write path produces a blob padded to the maximum for its key set. */
describe('vault adapter: blob length depends on the key set only', () => {
  const W12 = [...Array(11).fill('abandon'), 'about'].join(' ');
  const W24 = [...Array(23).fill('abandon'), 'art'].join(' ');
  /** overhead + maxPayloadBytes + 2: public data only. */
  const maxBlob = (rpId: string, ids: Uint8Array[]) => {
    const overhead = 42 + rpId.length + ids.reduce((n, c) => n + 1 + c.length + 12 + 48, 0) + 28;
    expect(maxPayloadBytes(rpId, ids) + 2).toBe(64 * Math.floor((1024 - overhead) / 64));
    return overhead + maxPayloadBytes(rpId, ids) + 2;
  };

  it('create: a 12-word and a 24-word seed give the same blob length, the 2-key maximum', async () => {
    const mk = (secret: string) =>
      createVaultBlob({ vaultId: vid(1), rpId: 'cryoshield.app', keys: [{ credId: id(1), prf: rand() }, { credId: id(2), prf: rand() }], payload: { archived: false, items: [{ label: 'Bitcoin seed', secret }] } });
    const [a, b] = [await mk(W12), await mk(W24)];
    expect(a.blob.length).toBe(b.blob.length);
    expect(a.blob.length).toBe(maxBlob('cryoshield.app', [id(1), id(2)]));
  });

  it('edit and add-key re-pad to the maximum for the key set they write', async () => {
    const a = rand();
    const { blob } = await createVaultBlob({ vaultId: vid(1), rpId: 'localhost', keys: [{ credId: id(1), prf: a.slice() }, { credId: id(2), prf: rand() }], payload: { archived: false, items: [{ label: 'Seed', secret: W24 }] } });
    const edited = await editVaultBlob(blob, a.slice(), vid(1), { archived: false, items: [{ label: 'x', secret: 'y' }] });
    expect(edited.length).toBe(blob.length);
    expect(edited.length).toBe(maxBlob('localhost', [id(1), id(2)]));
    const added = await addKeyToBlob(edited, a.slice(), vid(1), { credId: id(3), prf: rand() });
    expect(added.blob.length).toBe(maxBlob('localhost', [id(1), id(2), id(3)]));
    expect(decodeVault(added.blob).payloadCt.length).toBe(maxPayloadBytes('localhost', [id(1), id(2), id(3)]) + 2 + 16);
  });
});

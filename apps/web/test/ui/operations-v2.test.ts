/**
 * vault-list-labels-archive 2.1, 2.4, 2.5 and 4.1 (data layer): edits keep the name and the archived flag, the
 * name/archive update is one write (and a no-op is none), every write re-reads the vault first (STALE, before any key
 * tap), and Archive and clear keeps the blob length. Real vault-crypto and a fake authenticator; only the smart-account
 * construction is faked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeFunctionData, type Hex } from 'viem';
import { locatorSalt, maxPayloadBytes, openVault } from '@cryoshield/vault-crypto';
import { FakeAuthenticators } from '../fixtures/fake-webauthn';
import { enrollKey } from '../../src/webauthn';
import { capacity, createVaultBlob } from '../../src/vault/adapter';
import { decodeVaultPayload, writeVaultPayload } from '../../src/vault/payload';
import { registryV2Abi } from '../../src/chain/contracts';
import { fromHex } from '../../src/lib/bytes';
import { archiveAndClear, saveAddKey, saveEdit, saveVaultMeta, type VaultSession } from '../../src/ui/operations';
import { WriteError } from '../../src/account/errors';
import { fakeServices } from './helpers';

const OWNER = ('0x' + '34'.repeat(20)) as Hex;
vi.mock('../../src/account/stack', async (orig) => ({
  ...(await orig<typeof import('../../src/account/stack')>()),
  existingVaultAccount: async () => ({ getAddress: async () => OWNER }),
}));

const VAULT_ID = ('0x' + '07'.repeat(32)) as Hex;

async function setup(opts: { name?: string; archived?: boolean; items?: { label: string; secret: string }[] } = {}) {
  const f = new FakeAuthenticators();
  f.addKey();
  f.addKey();
  f.use(0);
  const a = await enrollKey({ rpId: 'localhost', rpName: 'x', label: 'a', exclude: [] }, f.credentials);
  f.use(1);
  const b = await enrollKey({ rpId: 'localhost', rpName: 'x', label: 'b', exclude: [] }, f.credentials);
  const items = opts.items ?? [{ label: 'Seed', secret: 'abandon art' }];
  const payload = { archived: opts.archived ?? false, items, ...(opts.name ? { name: opts.name } : {}) };
  const { blob } = await createVaultBlob({
    vaultId: VAULT_ID,
    rpId: 'localhost',
    keys: [
      { credId: a.credId, prf: await f.prfFor(a.credId, locatorSalt()) },
      { credId: b.credId, prf: await f.prfFor(b.credId, locatorSalt()) },
    ],
    payload,
  });
  f.use(0);
  f.calls.length = 0;
  const chain = { blob, version: 1, reads: 0 };
  const sponsor = {
    send: vi.fn(async (_acct: unknown, calls: readonly { data: Hex }[]) => {
      for (const c of calls) {
        const d = decodeFunctionData({ abi: registryV2Abi, data: c.data });
        if (d.functionName === 'updateVault') {
          chain.blob = fromHex((d.args as [Hex, Hex])[1]);
          chain.version++;
        }
      }
      return { userOpHash: '0x01' as Hex, success: true };
    }),
  };
  const reader = {
    getVault: vi.fn(async (vaultId: Hex) => {
      chain.reads++;
      return { vaultId, owner: OWNER, blob: chain.blob, version: chain.version, registry: 'v2' as const };
    }),
  };
  const client = { getChainId: async () => 31337, call: vi.fn(async () => ({ data: '0x' })) };
  const svc = fakeServices({ credentials: f.credentials, sponsor, reader: reader as never, client: client as never });
  const session: VaultSession = {
    vaultId: VAULT_ID,
    owner: OWNER,
    version: 1,
    blob,
    items,
    archived: payload.archived,
    ...(opts.name ? { name: opts.name } : {}),
    credIds: [a.credId, b.credId],
    registry: 'v2',
  };
  const open = async (bytes = chain.blob) => decodeVaultPayload(await openVault(bytes, { prf: await f.prfFor(a.credId, locatorSalt()) }, fromHex(VAULT_ID)));
  const gets = () => f.calls.filter((c) => c.kind === 'get').length;
  return { f, a, b, svc, sponsor, reader, chain, session, open, gets };
}

beforeEach(() => vi.clearAllMocks());

describe('2.1 edits keep the name and the archived flag', () => {
  it('saving an edit of a named, archived vault keeps n and "a":true', async () => {
    const t = await setup({ name: 'Family', archived: true });
    const next = await saveEdit(t.svc, t.session, [{ label: 'Seed', secret: 'new words' }], () => {});
    const p = await t.open();
    expect(p).toMatchObject({ version: 2, name: 'Family', archived: true, items: [{ label: 'Seed', secret: 'new words' }] });
    expect(next).toMatchObject({ name: 'Family', archived: true, items: [{ label: 'Seed', secret: 'new words' }] });
  });

  it('an unnamed active vault still writes v1 bytes (D2)', async () => {
    const t = await setup();
    await saveEdit(t.svc, t.session, [{ label: 'Seed', secret: 'x' }], () => {});
    expect((await t.open()).version).toBe(1);
  });

  it('a save with items drops z (cleared vault)', async () => {
    const t = await setup({ name: 'F', archived: true });
    const cleared = await archiveAndClear(t.svc, t.session, () => {});
    expect(cleared.pad).toBeDefined();
    const next = await saveEdit(t.svc, cleared, [{ label: 'a', secret: 'b' }], () => {});
    expect(next.pad).toBeUndefined();
    expect((await t.open()).pad).toBeUndefined();
  });
});

describe('2.4 saveVaultMeta: name and archived flag in one update', () => {
  it('a no-op sends no user operation and asks for no key tap', async () => {
    const t = await setup({ name: 'Work' });
    const next = await saveVaultMeta(t.svc, t.session, { name: 'Work', archived: false }, () => {});
    expect(next).toBe(t.session);
    expect(t.sponsor.send).not.toHaveBeenCalled();
    expect(t.gets()).toBe(0);
    expect(t.reader.getVault).not.toHaveBeenCalled();
  });

  it('rename and archive together are exactly one update', async () => {
    const t = await setup();
    const next = await saveVaultMeta(t.svc, t.session, { name: 'Old phone', archived: true }, () => {});
    expect(t.sponsor.send).toHaveBeenCalledTimes(1);
    expect(await t.open()).toMatchObject({ version: 2, name: 'Old phone', archived: true, items: t.session.items });
    expect(next).toMatchObject({ name: 'Old phone', archived: true, version: 2 });
  });

  it('clearing the name and unarchiving goes back to v1 bytes', async () => {
    const t = await setup({ name: 'X', archived: true });
    const next = await saveVaultMeta(t.svc, t.session, { archived: false }, () => {});
    expect((await t.open()).version).toBe(1);
    expect(next.name).toBeUndefined();
  });

  it('refuses an invalid name before any key tap', async () => {
    const t = await setup();
    await expect(saveVaultMeta(t.svc, t.session, { name: 'a\u202eb', archived: false }, () => {})).rejects.toBeTruthy();
    expect(t.gets()).toBe(0);
  });

  it('a full vault can still be archived (D11 reserve)', async () => {
    const t0 = await setup();
    const max = maxPayloadBytes('localhost', t0.session.credIds);
    const base = writeVaultPayload({ archived: false, items: [{ label: 'Seed', secret: '' }] }).length;
    const items = [{ label: 'Seed', secret: 'x'.repeat(max - base - 9) }];
    const cap = capacity('localhost', t0.session.credIds, { archived: false, items });
    expect(cap).toMatchObject({ remaining: 0, fits: true });
    expect(capacity('localhost', t0.session.credIds, { archived: false, items: [{ label: 'Seed', secret: 'x'.repeat(max - base - 8) }] }).fits).toBe(false);
    const t = await setup({ items });
    await saveVaultMeta(t.svc, t.session, { archived: true }, () => {});
    expect(await t.open()).toMatchObject({ archived: true, items });
  });
});

describe('2.5 / D8 every write starts from the current blob', () => {
  const stale = async () => {
    const t = await setup({ name: 'Family' });
    const other = await setup({ name: 'Other' });
    t.chain.blob = other.chain.blob; // saved from another device after this session opened it
    return t;
  };
  const cases: [string, (t: Awaited<ReturnType<typeof setup>>) => Promise<unknown>][] = [
    ['edit', (t) => saveEdit(t.svc, t.session, [{ label: 'a', secret: 'b' }], () => {})],
    ['rename', (t) => saveVaultMeta(t.svc, t.session, { name: 'New', archived: false }, () => {})],
    ['archive', (t) => saveVaultMeta(t.svc, t.session, { name: 'Family', archived: true }, () => {})],
    ['archive and clear', (t) => archiveAndClear(t.svc, t.session, () => {})],
    ['add key', (t) => saveAddKey(t.svc, t.session, { onInsertNew: () => {}, onNewAgain: () => {}, onSign: () => {} })],
  ];
  it.each(cases)('%s: STALE, no key tap, no signature, nothing sent', async (_, run) => {
    const t = await stale();
    const e = await run(t).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(WriteError);
    expect((e as WriteError).code).toBe('STALE');
    expect(t.gets()).toBe(0);
    expect(t.f.calls.filter((c) => c.kind === 'create')).toHaveLength(0);
    expect(t.sponsor.send).not.toHaveBeenCalled();
  });

  it('a vault that is gone is STALE too', async () => {
    const t = await setup();
    t.reader.getVault.mockResolvedValueOnce(null as never);
    await expect(saveEdit(t.svc, t.session, [{ label: 'a', secret: 'b' }], () => {})).rejects.toMatchObject({ code: 'STALE' });
  });
});

describe('4.1 Archive and clear', () => {
  it('keeps the blob length and the name, sets the flag, holds no items, in one update', async () => {
    const t = await setup({ name: 'Family', items: [{ label: 'One', secret: 'a'.repeat(40) }, { label: 'Two', secret: 'b'.repeat(70) }, { label: 'Three', secret: 'c' }] });
    const before = t.chain.blob.length;
    const next = await archiveAndClear(t.svc, t.session, () => {});
    expect(t.sponsor.send).toHaveBeenCalledTimes(1);
    expect(t.chain.blob.length).toBe(before);
    const p = await t.open();
    expect(p).toMatchObject({ version: 2, name: 'Family', archived: true, items: [] });
    expect(p.pad).toMatch(/^0+$/);
    expect(next).toMatchObject({ name: 'Family', archived: true, items: [], blob: t.chain.blob });
  });

  it('a tiny vault is never shorter afterwards', async () => {
    const t = await setup({ items: [{ label: '', secret: '' }] });
    const before = t.chain.blob.length;
    await archiveAndClear(t.svc, t.session, () => {});
    expect(t.chain.blob.length).toBeGreaterThanOrEqual(before);
  });
});

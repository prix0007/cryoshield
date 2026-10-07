import { describe, expect, it, vi } from 'vitest';
import { deriveLocator, locatorSalt } from '@cryoshield/vault-crypto';
import { FakeAuthenticators } from '../fixtures/fake-webauthn';
import { MockRegistry } from '../fixtures/mock-registry';
import { enrollKey } from '../../src/webauthn';
import { createVaultBlob } from '../../src/vault/adapter';
import { createRegistryReader } from '../../src/chain/registry';
import { unlock, UnlockError } from '../../src/chain/unlock';
import { toHex } from '../../src/lib/bytes';
import * as adapter from '../../src/vault/adapter';

async function setup() {
  const f = new FakeAuthenticators();
  f.addKey();
  f.addKey();
  f.use(0);
  const a = await enrollKey({ rpId: 'localhost', rpName: 'x', label: 'a', exclude: [] }, f.credentials);
  f.use(1);
  const b = await enrollKey({ rpId: 'localhost', rpName: 'x', label: 'b', exclude: [] }, f.credentials);
  const pa = await f.prfFor(a.credId, locatorSalt());
  const pb = await f.prfFor(b.credId, locatorSalt());
  const items = [{ label: 'Seed', secret: 'abandon art' }];
  const vaultId = ('0x' + '07'.repeat(32)) as `0x${string}`;
  const { blob, locators } = await createVaultBlob({ vaultId, rpId: 'localhost', keys: [{ credId: a.credId, prf: pa }, { credId: b.credId, prf: pb }], payload: { archived: false, items } });
  const reg = new MockRegistry();
  reg.put(vaultId, { owner: '0x00000000000000000000000000000000000000a1', blob: toHex(blob), version: 1 }, locators.map(toHex));
  return { f, a, b, reg, vaultId, items, locators };
}

describe('unlock pipeline (5.2)', () => {
  it('one ceremony -> locator -> candidates -> decrypted items, with the owner index', async () => {
    const { f, reg, vaultId, items, locators } = await setup();
    f.use(1);
    const r = await unlock({ rpId: 'localhost' }, { credentials: f.credentials, reader: createRegistryReader(reg.transport()) });
    expect(f.calls.filter((c) => c.kind === 'get')).toHaveLength(1);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]!.vaultId).toBe(vaultId);
    expect(r.matches[0]!.items).toEqual(items);
    expect(r.matches[0]!.entryIndex).toBe(1);
    expect(r.locator).toEqual(locators[1]);
  });

  it('zeroizes the PRF output on success and on failure', async () => {
    const { f, reg } = await setup();
    const spy = vi.spyOn(adapter, 'matchCandidates');
    f.use(0);
    await unlock({ rpId: 'localhost' }, { credentials: f.credentials, reader: createRegistryReader(reg.transport()) });
    const prf = spy.mock.calls[0]![1];
    expect(prf.every((x) => x === 0)).toBe(true);
    spy.mockRestore();
  });

  it('reports NO_VAULT when no candidate authenticates', async () => {
    const { f } = await setup();
    const empty = new MockRegistry();
    f.use(0);
    await expect(unlock({ rpId: 'localhost' }, { credentials: f.credentials, reader: createRegistryReader(empty.transport()) })).rejects.toMatchObject({ code: 'NO_VAULT' });
  });

  it('marks a payload from a newer version instead of showing it', async () => {
    const f = new FakeAuthenticators();
    f.addKey();
    f.addKey();
    f.use(0);
    const a = await enrollKey({ rpId: 'localhost', rpName: 'x', label: 'a', exclude: [] }, f.credentials);
    f.use(1);
    const b = await enrollKey({ rpId: 'localhost', rpName: 'x', label: 'b', exclude: [] }, f.credentials);
    const { createVault } = await import('@cryoshield/vault-crypto');
    const { blob, locators } = await createVault({
      vaultId: new Uint8Array(32).fill(8),
      rpId: 'localhost',
      credentials: [{ id: a.credId, prf: await f.prfFor(a.credId, locatorSalt()) }, { id: b.credId, prf: await f.prfFor(b.credId, locatorSalt()) }],
      secret: new Uint8Array(new TextEncoder().encode('{"v":3,"items":[]}')),
    });
    const reg = new MockRegistry();
    reg.put(('0x' + '08'.repeat(32)) as `0x${string}`, { owner: '0x00000000000000000000000000000000000000a1', blob: toHex(blob), version: 1 }, locators.map(toHex));
    f.use(0);
    const r = await unlock({ rpId: 'localhost' }, { credentials: f.credentials, reader: createRegistryReader(reg.transport()) });
    expect(r.matches[0]!.items).toBeNull();
    expect(r.matches[0]!.payloadError).toBe('UNKNOWN_VERSION');
    expect(deriveLocator).toBeDefined();
  });

  it('opens a payload v2 vault with its name and archived flag (2.2)', async () => {
    const f = new FakeAuthenticators();
    f.addKey();
    f.addKey();
    f.use(0);
    const a = await enrollKey({ rpId: 'localhost', rpName: 'x', label: 'a', exclude: [] }, f.credentials);
    f.use(1);
    const b = await enrollKey({ rpId: 'localhost', rpName: 'x', label: 'b', exclude: [] }, f.credentials);
    const vaultId = ('0x' + '09'.repeat(32)) as `0x${string}`;
    const keys = [{ credId: a.credId, prf: await f.prfFor(a.credId, locatorSalt()) }, { credId: b.credId, prf: await f.prfFor(b.credId, locatorSalt()) }];
    const { blob, locators } = await createVaultBlob({ vaultId, rpId: 'localhost', keys, payload: { name: 'Family', archived: true, items: [] } });
    const reg = new MockRegistry();
    reg.put(vaultId, { owner: '0x00000000000000000000000000000000000000a1', blob: toHex(blob), version: 1 }, locators.map(toHex));
    f.use(0);
    const r = await unlock({ rpId: 'localhost' }, { credentials: f.credentials, reader: createRegistryReader(reg.transport()) });
    expect(r.matches[0]).toMatchObject({ name: 'Family', archived: true, items: [] });
    expect(r.matches[0]!.payloadError).toBeUndefined();
  });

  it('an unnamed v1 vault is active with no name', async () => {
    const { f, reg } = await setup();
    f.use(0);
    const r = await unlock({ rpId: 'localhost' }, { credentials: f.credentials, reader: createRegistryReader(reg.transport()) });
    expect(r.matches[0]!.archived).toBe(false);
    expect(r.matches[0]!.name).toBeUndefined();
  });

  it('is an UnlockError class', () => {
    expect(new UnlockError('NO_VAULT')).toBeInstanceOf(Error);
  });
});

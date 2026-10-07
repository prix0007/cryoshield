/**
 * Task 3.6: across real ceremonies, vault creation, unlock and payload handling, no code path touches web storage
 * or the console. Uses the fake authenticator + mock registry.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { locatorSalt } from '@cryoshield/vault-crypto';
import { FakeAuthenticators } from './fixtures/fake-webauthn';
import { MockRegistry } from './fixtures/mock-registry';
import { enrollKey, evaluatePrf } from '../src/webauthn';
import { createVaultBlob } from '../src/vault/adapter';
import { createRegistryReader } from '../src/chain/registry';
import { unlock } from '../src/chain/unlock';
import { toHex } from '../src/lib/bytes';

afterEach(() => vi.restoreAllMocks());

describe('no storage, no logging (3.6)', () => {
  it('ceremonies + create + unlock never call storage or console', async () => {
    const spies = [
      vi.spyOn(Storage.prototype, 'setItem'),
      vi.spyOn(Storage.prototype, 'getItem'),
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'info'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
      vi.spyOn(console, 'debug'),
    ];
    const idbOpen = vi.fn();
    (globalThis as { indexedDB?: unknown }).indexedDB = { open: idbOpen };
    const cookie = vi.spyOn(document, 'cookie', 'set');
    const f = new FakeAuthenticators();
    f.addKey();
    f.addKey();
    f.use(0);
    const a = await enrollKey({ rpId: 'localhost', rpName: 'x', label: 'a', exclude: [] }, f.credentials);
    f.use(1);
    const b = await enrollKey({ rpId: 'localhost', rpName: 'x', label: 'b', exclude: [a.credId] }, f.credentials);
    f.use(0);
    const pa = (await evaluatePrf({ rpId: 'localhost', credId: a.credId }, f.credentials)).prf;
    const pb = await f.prfFor(b.credId, locatorSalt());
    const { blob, locators } = await createVaultBlob({ vaultId: ('0x' + '01'.repeat(32)) as `0x${string}`, rpId: 'localhost', keys: [{ credId: a.credId, prf: pa }, { credId: b.credId, prf: pb }], payload: { archived: false, items: [{ label: 'x', secret: 'y' }] } });
    const reg = new MockRegistry();
    reg.put(('0x' + '01'.repeat(32)) as `0x${string}`, { owner: '0x00000000000000000000000000000000000000a1', blob: toHex(blob), version: 1 }, locators.map(toHex));
    f.use(0);
    await unlock({ rpId: 'localhost' }, { credentials: f.credentials, reader: createRegistryReader(reg.transport()) });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    expect(idbOpen).not.toHaveBeenCalled();
    expect(cookie).not.toHaveBeenCalled();
    expect(pa.every((x) => x === 0)).toBe(true);
  });
});

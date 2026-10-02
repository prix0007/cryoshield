import { describe, expect, it, vi } from 'vitest';
import { encodeErrorResult, type Hex } from 'viem';
import { registryAbi } from 'virtual:cryoshield-config';
import { createVaultOnChain, registryError, updateVaultOnChain, WriteError } from '../../src/account/writes';

const owner = '0x00000000000000000000000000000000000000aa' as Hex;
const account = { getAddress: async () => owner } as never;
const blob = new Uint8Array([1, 2, 3]);
const okClient = { getChainId: async () => 31337, call: vi.fn(async () => ({ data: '0x' })) } as never;
const reader = (b: Uint8Array | null) => ({ getVault: async (vaultId: Hex) => (b ? { vaultId, owner, blob: b, version: 2 } : null) }) as never;
const revert = (name: string, args: unknown[]) => encodeErrorResult({ abi: registryAbi as any, errorName: name, args } as never);

describe('registry error mapping (6.7)', () => {
  it.each([
    ['VaultIdTaken', ['0x' + '11'.repeat(32)], 'VAULT_ID_TAKEN'],
    ['LocatorFull', ['0x' + '22'.repeat(32)], 'LOCATOR_FULL'],
    ['OwnerAlreadyHasVault', [owner], 'ALREADY_HAS_VAULT'],
    ['TooManyLocators', [9n], 'TOO_MANY_KEYS'],
    ['InvalidBlobSize', [2000n], 'TOO_LARGE'],
    ['NotVaultOwner', ['0x' + '11'.repeat(32), owner], 'NOT_OWNER'],
  ])('%s -> %s', (name, args, code) => {
    const e = registryError(revert(name, args));
    expect(e.code).toBe(code);
    if (name === 'LocatorFull') expect(e.detail.locator).toBe('0x' + '22'.repeat(32));
  });
  it('unknown data -> REVERTED', () => expect(registryError('0xdeadbeef').code).toBe('REVERTED'));
});

describe('write confirmation (6.8)', () => {
  it('reports Saved only when the receipt succeeded and the read-back equals the blob', async () => {
    const sponsor = { send: vi.fn(async () => ({ userOpHash: '0x01' as Hex, success: true })) };
    const r = await updateVaultOnChain({ account, vaultId: ('0x' + '33'.repeat(32)) as Hex, blob }, { client: okClient, sponsor, reader: reader(blob) });
    expect(r.version).toBe(2);
    await expect(updateVaultOnChain({ account, vaultId: ('0x' + '33'.repeat(32)) as Hex, blob }, { client: okClient, sponsor, reader: reader(new Uint8Array([9])) })).rejects.toMatchObject({ code: 'NOT_CONFIRMED' });
  });

  it('an included-but-reverted operation is REVERTED (nothing saved)', async () => {
    const sponsor = { send: vi.fn(async () => ({ userOpHash: '0x01' as Hex, success: false, reason: '0x' as Hex })) };
    await expect(updateVaultOnChain({ account, vaultId: ('0x' + '33'.repeat(32)) as Hex, blob }, { client: okClient, sponsor, reader: reader(blob) })).rejects.toMatchObject({ code: 'REVERTED' });
  });

  it('10.7: on VaultIdTaken, re-encrypts under a FRESH vaultId (build called again), tells the UI, retries once, then gives up', async () => {
    const sponsor = { send: vi.fn(async () => ({ userOpHash: '0x01' as Hex, success: false, reason: revert('VaultIdTaken', ['0x' + '11'.repeat(32)]) })) };
    let n = 0;
    const built: Hex[] = [];
    const onRetry = vi.fn();
    const err = await createVaultOnChain(
      { account, build: async (vaultId: Hex) => (built.push(vaultId), { blob, locators: [('0x' + '44'.repeat(32)) as Hex, ('0x' + '55'.repeat(32)) as Hex] }) },
      { client: okClient, sponsor, reader: reader(blob), randomId: () => (('0x' + (++n).toString(16).padStart(64, '0')) as Hex), onRetry },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(WriteError);
    expect(err.code).toBe('VAULT_ID_TAKEN');
    expect(sponsor.send).toHaveBeenCalledTimes(2);
    expect(built).toHaveLength(2);
    expect(built[0]).not.toBe(built[1]);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('10.7: a preflight VaultIdTaken rebuilds under a fresh id before any signing', async () => {
    const { BaseError } = await import('viem');
    const data = revert('VaultIdTaken', ['0x' + '11'.repeat(32)]);
    let calls = 0;
    const client = { getChainId: async () => 31337, call: vi.fn(async () => { if (calls++ === 0) throw new (class extends BaseError { data = data; constructor() { super('reverted'); } })(); return { data: '0x' }; }) } as never;
    const sponsor = { send: vi.fn(async () => ({ userOpHash: '0x01' as Hex, success: true })) };
    const built: Hex[] = [];
    const r = await createVaultOnChain(
      { account, build: async (vaultId: Hex) => (built.push(vaultId), { blob, locators: [] }) },
      { client, sponsor, reader: reader(blob) },
    );
    expect(built).toHaveLength(2);
    expect(r.vaultId).toBe(built[1]);
    expect(sponsor.send).toHaveBeenCalledTimes(1);
  });

  it('preflight LocatorFull stops before any signing/sending', async () => {
    const client = { getChainId: async () => 31337, call: vi.fn(async () => { const e: any = new Error('reverted'); throw Object.assign(e, {}); }) } as never;
    const sponsor = { send: vi.fn() };
    const { BaseError } = await import('viem');
    const data = revert('LocatorFull', ['0x' + '22'.repeat(32)]);
    (client as any).call = vi.fn(async () => { throw new (class extends BaseError { data = data; constructor() { super('reverted'); } })(); });
    const err = await createVaultOnChain({ account, build: async () => ({ blob, locators: [] }) }, { client, sponsor: sponsor as never, reader: reader(blob) }).catch((e) => e);
    expect(err.code).toBe('LOCATOR_FULL');
    expect(sponsor.send).not.toHaveBeenCalled();
  });
});

describe('review fix 6: add-key asserts nextOwnerIndex == keyCount before signing', () => {
  it('refuses when the account owner count does not match the blob', async () => {
    const { addKeyOnChain } = await import('../../src/account/writes');
    const { decodeVault } = await import('@cryoshield/vault-crypto');
    void decodeVault;
    const onSign = vi.fn();
    const sponsor = { send: vi.fn() };
    const client = { getChainId: async () => 31337, call: vi.fn(async () => ({ data: '0x' })), readContract: vi.fn(async () => 5n) } as never;
    const err = await addKeyOnChain(
      { account, vaultId: ('0x' + '33'.repeat(32)) as Hex, blob, newLocator: ('0x' + '44'.repeat(32)) as Hex, newPublicKey: ('0x' + 'aa'.repeat(64)) as Hex, keyCountBefore: 2 },
      { client, sponsor: sponsor as never, reader: reader(blob), onSign },
    ).catch((e) => e);
    expect(err.code).toBe('OWNER_MISMATCH');
    expect(onSign).not.toHaveBeenCalled();
    expect(sponsor.send).not.toHaveBeenCalled();
  });
  it('proceeds when nextOwnerIndex == keyCount', async () => {
    const { addKeyOnChain } = await import('../../src/account/writes');
    const sponsor = { send: vi.fn(async () => ({ userOpHash: '0x01' as Hex, success: true })) };
    const client = { getChainId: async () => 31337, call: vi.fn(async () => ({ data: '0x' })), readContract: vi.fn(async () => 2n) } as never;
    const r = await addKeyOnChain(
      { account, vaultId: ('0x' + '33'.repeat(32)) as Hex, blob, newLocator: ('0x' + '44'.repeat(32)) as Hex, newPublicKey: ('0x' + 'aa'.repeat(64)) as Hex, keyCountBefore: 2 },
      { client, sponsor: sponsor as never, reader: reader(blob) },
    );
    expect(r.version).toBe(2);
  });
});

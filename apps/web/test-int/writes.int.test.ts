import { describe, expect, it } from 'vitest';
import { http, type Hex } from 'viem';
import { locatorSalt } from '@cryoshield/vault-crypto';
import { FakeAuthenticators } from '../test/fixtures/fake-webauthn';
import { enrollKey } from '../src/webauthn';
import { createRegistryReader } from '../src/chain/registry';
import { unlock } from '../src/chain/unlock';
import { addKeyToBlob, createVaultBlob, editVaultBlob } from '../src/vault/adapter';
import { existingVaultAccount, makePublicClient, newVaultAccount, ownerPublicKeyAt } from '../src/account/account';
import { addKeyOnChain, createSponsor, createVaultOnChain, updateVaultOnChain, WriteError } from '../src/account/writes';
import { decodeVault, deriveLocator } from '@cryoshield/vault-crypto';
import { toHex } from '../src/lib/bytes';

const rpc = http('http://127.0.0.1:8545');

async function control(method: string, params: unknown[] = []) {
  const r = await fetch('http://127.0.0.1:4337', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return (await r.json()).result;
}

async function twoKeys() {
  const f = new FakeAuthenticators();
  f.addKey();
  f.addKey();
  f.use(0);
  const a = await enrollKey({ rpId: 'localhost', rpName: 'x', label: 'a', exclude: [] }, f.credentials);
  f.use(1);
  const b = await enrollKey({ rpId: 'localhost', rpName: 'x', label: 'b', exclude: [a.credId] }, f.credentials);
  return { f, a, b };
}

function buildFor(items: { label: string; secret: string }[], keys: { credId: Uint8Array; prf: Uint8Array }[]) {
  return async (vaultId: Hex) => {
    const r = await createVaultBlob({ vaultId, rpId: 'localhost', keys: keys.map((k) => ({ credId: k.credId, prf: k.prf.slice() })), items });
    return { blob: r.blob, locators: r.locators.map(toHex) };
  };
}

async function createOne(items = [{ label: 'Seed', secret: 'abandon art' }]) {
  const { f, a, b } = await twoKeys();
  const client = makePublicClient(rpc);
  const reader = createRegistryReader(rpc);
  const sponsor = createSponsor(client);
  const pa = await f.prfFor(a.credId, locatorSalt());
  const pb = await f.prfFor(b.credId, locatorSalt());
  const locators = [deriveLocator(pa), deriveLocator(pb)];
  const build = buildFor(items, [{ credId: a.credId, prf: pa }, { credId: b.credId, prf: pb }]);
  f.use(0);
  const account = await newVaultAccount({ client, owners: [a, b], signerIndex: 0, expectedLocator: locators[0]!, credentials: f.credentials });
  const res = await createVaultOnChain({ account, build }, { client, sponsor, reader });
  return { f, a, b, client, reader, sponsor, res, locators };
}

describe('sponsored writes against EntryPoint v0.6 + Coinbase Smart Wallet (6.1, 6.3-6.5)', () => {
  it('creates a vault from a zero-balance account; owners are the keys in blob order', async () => {
    const { a, b, client, res } = await createOne();
    expect(await client.getBalance({ address: res.owner })).toBe(0n);
    expect(await ownerPublicKeyAt(client, res.owner, 0)).toBe(a.publicKey);
    expect(await ownerPublicKeyAt(client, res.owner, 1)).toBe(b.publicKey);
    expect(res.version).toBe(1);
  });

  it('edit with key B, then unlock with key A sees the change (version +1)', async () => {
    const { f, b, client, reader, sponsor, res } = await createOne();
    f.use(1);
    const opened = await unlock({ rpId: 'localhost' }, { credentials: f.credentials, reader });
    const m = opened.matches[0]!;
    expect(m.entryIndex).toBe(1);
    const prf = await f.prfFor(b.credId, locatorSalt());
    const newBlob = await editVaultBlob(m.blob, prf, m.vaultId, [...m.items!, { label: 'Email', secret: 'JBSW' }]);
    const account = await existingVaultAccount({ client, address: m.owner, entryIndex: 1, credId: b.credId, expectedLocator: opened.locator, credentials: f.credentials });
    const up = await updateVaultOnChain({ account, vaultId: res.vaultId, blob: newBlob }, { client, sponsor, reader });
    expect(up.version).toBe(2);
    f.use(0);
    const again = await unlock({ rpId: 'localhost' }, { credentials: f.credentials, reader });
    expect(again.matches[0]!.items!.map((i) => i.label)).toEqual(['Seed', 'Email']);
  });

  it('adds key C atomically with one existing key; C alone unlocks; account has 3 owners', async () => {
    const { f, a, client, reader, sponsor, res } = await createOne();
    const ci = f.addKey();
    f.use(ci);
    const c = await enrollKey({ rpId: 'localhost', rpName: 'x', label: 'c', exclude: [] }, f.credentials);
    const added = await addKeyToBlob(res.blob, await f.prfFor(a.credId, locatorSalt()), res.vaultId, { credId: c.credId, prf: await f.prfFor(c.credId, locatorSalt()) });
    f.use(0);
    const loc0 = res.locators[0]!;
    const account = await existingVaultAccount({ client, address: res.owner, entryIndex: 0, credId: a.credId, expectedLocator: hexToBytes(loc0), credentials: f.credentials });
    await addKeyOnChain({ account, vaultId: res.vaultId, blob: added.blob, newLocator: toHex(added.locator), newPublicKey: c.publicKey, keyCountBefore: 2 }, { client, sponsor, reader });
    expect(await ownerPublicKeyAt(client, res.owner, 2)).toBe(c.publicKey);
    expect(decodeVault((await reader.getVault(res.vaultId))!.blob).keyCount).toBe(3);
    f.use(ci);
    const opened = await unlock({ rpId: 'localhost' }, { credentials: f.credentials, reader });
    expect(opened.matches[0]!.entryIndex).toBe(2);
    expect(opened.matches[0]!.items![0]!.label).toBe('Seed');
  });

  it('retries once on VaultIdTaken, then succeeds with a fresh id', async () => {
    const first = await createOne();
    const { f, a, b } = await twoKeys();
    const client = makePublicClient(rpc);
    const reader = createRegistryReader(rpc);
    const pa = await f.prfFor(a.credId, locatorSalt());
    const pb = await f.prfFor(b.credId, locatorSalt());
    const locators = [deriveLocator(pa), deriveLocator(pb)];
    const build = buildFor([{ label: 'x', secret: 'y' }], [{ credId: a.credId, prf: pa }, { credId: b.credId, prf: pb }]);
    f.use(0);
    const account = await newVaultAccount({ client, owners: [a, b], signerIndex: 0, expectedLocator: locators[0]!, credentials: f.credentials });
    const ids = [first.res.vaultId, ('0x' + 'ee'.repeat(31) + '01') as Hex];
    const res = await createVaultOnChain({ account, build }, { client, sponsor: createSponsor(client), reader, randomId: () => ids.shift()! });
    expect(res.vaultId).toBe('0x' + 'ee'.repeat(31) + '01');
  });

  it('maps paymaster refusal to SPONSORSHIP_REFUSED and never sends unsponsored', async () => {
    const { f, a, b } = await twoKeys();
    const client = makePublicClient(rpc);
    const reader = createRegistryReader(rpc);
    const pa = await f.prfFor(a.credId, locatorSalt());
    const pb = await f.prfFor(b.credId, locatorSalt());
    const locators = [deriveLocator(pa), deriveLocator(pb)];
    const build = buildFor([{ label: 'x', secret: 'y' }], [{ credId: a.credId, prf: pa }, { credId: b.credId, prf: pb }]);
    f.use(0);
    const account = await newVaultAccount({ client, owners: [a, b], signerIndex: 0, expectedLocator: locators[0]!, credentials: f.credentials });
    const before = (await control('cryoshield_stats')).sponsored;
    await control('cryoshield_setPolicy', [{ refuseAll: true }]);
    try {
      const err = await createVaultOnChain({ account, build }, { client, sponsor: createSponsor(client), reader }).catch((e) => e);
      expect(err).toBeInstanceOf(WriteError);
      expect(err.code).toBe('SPONSORSHIP_REFUSED');
    } finally {
      await control('cryoshield_setPolicy', [{ refuseAll: false }]);
    }
    expect((await control('cryoshield_stats')).sponsored).toBe(before);
    expect(f.calls.filter((c) => c.kind === 'get')).toHaveLength(0); // refused before the signing tap
  });
});

describe('on-chain verification and registry errors', () => {
  it('rejects a signature from an enrolled key that is not the owner at that index (P-256 really verified)', async () => {
    const { f, b, client, reader, sponsor, res, locators } = await createOne();
    f.use(1);
    // ownerIndex 0 holds A's public key, but key B signs.
    const account = await existingVaultAccount({ client, address: res.owner, entryIndex: 0, credId: b.credId, expectedLocator: locators[1]!, credentials: f.credentials });
    const err = await updateVaultOnChain({ account, vaultId: res.vaultId, blob: res.blob }, { client, sponsor, reader }).catch((e) => e);
    expect(err).toBeInstanceOf(WriteError);
    expect((await reader.getVault(res.vaultId))!.version).toBe(1);
  });

  it('LocatorFull in preflight surfaces LOCATOR_FULL with the locator, before any signing tap', async () => {
    const { f, a, b } = await twoKeys();
    const client = makePublicClient(rpc);
    const reader = createRegistryReader(rpc);
    const pa = await f.prfFor(a.credId, locatorSalt());
    const pb = await f.prfFor(b.credId, locatorSalt());
    const locators = [deriveLocator(pa), deriveLocator(pb)];
    const build = buildFor([{ label: 'x', secret: 'y' }], [{ credId: a.credId, prf: pa }, { credId: b.credId, prf: pb }]);
    // A front-runner fills key B's locator with 16 junk vaults (16 different owners).
    const { createTestClient, createWalletClient, encodeFunctionData, keccak256, toHex: vToHex } = await import('viem');
    const { registryAbi, config } = await import('virtual:cryoshield-config');
    const chain = { id: 31337, name: 'anvil', nativeCurrency: { name: 'E', symbol: 'E', decimals: 18 }, rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } } } as const;
    const t = createTestClient({ chain, transport: rpc, mode: 'anvil' });
    const w = createWalletClient({ chain, transport: rpc });
    const target = toHex(locators[1]!);
    for (let i = 0; i < 16; i++) {
      const from = ('0x' + (0x1000 + i).toString(16).padStart(40, '0')) as Hex;
      await t.impersonateAccount({ address: from });
      await t.setBalance({ address: from, value: 10n ** 18n });
      const id = keccak256(vToHex(`junk-${Date.now()}-${i}`));
      await w.sendTransaction({ account: from, chain, to: config.registry.address, data: encodeFunctionData({ abi: registryAbi as any, functionName: 'createVault', args: [id, '0xdead', [target, keccak256(id)]] }) } as never);
    }
    f.use(0);
    const account = await newVaultAccount({ client, owners: [a, b], signerIndex: 0, expectedLocator: locators[0]!, credentials: f.credentials });
    const err = await createVaultOnChain({ account, build }, { client, sponsor: createSponsor(client), reader }).catch((e) => e);
    expect(err.code).toBe('LOCATOR_FULL');
    expect(err.detail.locator).toBe(target);
    expect(f.calls.filter((c) => c.kind === 'get')).toHaveLength(0);
  });
});

describe('10.7: vault cloning is neutralised (vaultId bound into the ciphertext)', () => {
  it('a byte-identical clone of the victim blob + locators under an attacker vaultId is never offered', async () => {
    const { f, res, reader } = await createOne([{ label: 'Seed', secret: 'victim secret' }]);
    const { createTestClient, createWalletClient, encodeFunctionData, keccak256, toHex: vToHex } = await import('viem');
    const { registryAbi, config } = await import('virtual:cryoshield-config');
    const chain = { id: 31337, name: 'anvil', nativeCurrency: { name: 'E', symbol: 'E', decimals: 18 }, rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } } } as const;
    const t = createTestClient({ chain, transport: rpc, mode: 'anvil' });
    const w = createWalletClient({ chain, transport: rpc });
    const attacker = '0x00000000000000000000000000000000000a77ac' as Hex;
    await t.impersonateAccount({ address: attacker });
    await t.setBalance({ address: attacker, value: 10n ** 18n });
    const cloneId = keccak256(vToHex(`clone-${Date.now()}`));
    await w.sendTransaction({
      account: attacker,
      chain,
      to: config.registry.address,
      data: encodeFunctionData({ abi: registryAbi as any, functionName: 'createVault', args: [cloneId, toHex(res.blob), res.locators] }),
    } as never);
    // The clone is on-chain under the victim's locators, byte-identical...
    const cands = await reader.candidatesFor(res.locators[0]!);
    expect(cands.map((c) => c.vaultId.toLowerCase())).toEqual(expect.arrayContaining([res.vaultId.toLowerCase(), cloneId.toLowerCase()]));
    expect(toHex(cands.find((c) => c.vaultId.toLowerCase() === cloneId.toLowerCase())!.blob)).toBe(toHex(res.blob));
    // ...but unlocking offers only the genuine vault.
    for (const k of [0, 1]) {
      f.use(k);
      const opened = await unlock({ rpId: 'localhost' }, { credentials: f.credentials, reader });
      expect(opened.matches.map((m) => m.vaultId.toLowerCase())).toEqual([res.vaultId.toLowerCase()]);
      expect(opened.matches[0]!.owner.toLowerCase()).toBe(res.owner.toLowerCase());
    }
  });
});

function hexToBytes(h: Hex) {
  return Uint8Array.from(Buffer.from(h.slice(2), 'hex'));
}

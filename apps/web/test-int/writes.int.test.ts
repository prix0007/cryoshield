import { describe, expect, it } from 'vitest';
import { createTestClient, createWalletClient, encodeFunctionData as vEncode, http, keccak256 as vKeccak, toHex as vToHexStr, type Hex } from 'viem';
import { locatorSalt } from '@cryoshield/vault-crypto';
import { FakeAuthenticators } from '../test/fixtures/fake-webauthn';
import { enrollKey } from '../src/webauthn';
import { createRegistryReader } from '../src/chain/registry';
import { unlock } from '../src/chain/unlock';
import { addKeyToBlob, createVaultBlob, editVaultBlob } from '../src/vault/adapter';
import { existingVaultAccount, makePublicClient, newVaultAccount, ownerPublicKeyAt } from '../src/account/account';
import { addKeyOnChain, createSponsor, createVaultOnChain, sponsoredOpsUsed, updateVaultOnChain, WriteError } from '../src/account/writes';
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
    const r = await createVaultBlob({ vaultId, rpId: 'localhost', keys: keys.map((k) => ({ credId: k.credId, prf: k.prf.slice() })), payload: { archived: false, items } });
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
    const newBlob = await editVaultBlob(m.blob, prf, m.vaultId, { archived: false, items: [...m.items!, { label: 'Email', secret: 'JBSW' }] });
    const account = await existingVaultAccount({ client, address: m.owner, entryIndex: 1, credId: b.credId, expectedLocator: opened.locator, credentials: f.credentials });
    const up = await updateVaultOnChain({ account, vaultId: res.vaultId, blob: newBlob, base: m.blob }, { client, sponsor, reader });
    expect(up.version).toBe(2);
    f.use(0);
    const again = await unlock({ rpId: 'localhost' }, { credentials: f.credentials, reader });
    expect(again.matches[0]!.items!.map((i) => i.label)).toEqual(['Seed', 'Email']);
  });

  it('vault-list-labels-archive D8: a write based on an older blob is STALE and changes nothing', async () => {
    const { f, b, client, reader, sponsor, res } = await createOne();
    f.use(1);
    const opened = await unlock({ rpId: 'localhost' }, { credentials: f.credentials, reader });
    const m = opened.matches[0]!;
    const account = await existingVaultAccount({ client, address: m.owner, entryIndex: 1, credId: b.credId, expectedLocator: opened.locator, credentials: f.credentials });
    const first = await editVaultBlob(m.blob, await f.prfFor(b.credId, locatorSalt()), m.vaultId, { archived: false, items: [{ label: 'Seed', secret: 'from device 1' }] });
    await updateVaultOnChain({ account, vaultId: res.vaultId, blob: first, base: m.blob }, { client, sponsor, reader });
    const second = await editVaultBlob(m.blob, await f.prfFor(b.credId, locatorSalt()), m.vaultId, { archived: false, items: [{ label: 'Seed', secret: 'stale device 2' }] });
    const gets = f.calls.filter((c) => c.kind === 'get').length;
    const err = await updateVaultOnChain({ account, vaultId: res.vaultId, blob: second, base: m.blob }, { client, sponsor, reader }).catch((e) => e);
    expect(err).toBeInstanceOf(WriteError);
    expect(err.code).toBe('STALE');
    expect(f.calls.filter((c) => c.kind === 'get')).toHaveLength(gets); // no signing tap
    expect((await reader.getVault(res.vaultId))!.version).toBe(2);
  });

  it('vault-list-labels-archive D10: EntryPoint.getNonce(account, 0) counts the create and each edit (nonce key 0)', async () => {
    const { f, b, client, reader, sponsor, res } = await createOne();
    expect(await sponsoredOpsUsed(client, res.owner)).toBe(1);
    f.use(1);
    const opened = await unlock({ rpId: 'localhost' }, { credentials: f.credentials, reader });
    const m = opened.matches[0]!;
    const account = await existingVaultAccount({ client, address: m.owner, entryIndex: 1, credId: b.credId, expectedLocator: opened.locator, credentials: f.credentials });
    const next = await editVaultBlob(m.blob, await f.prfFor(b.credId, locatorSalt()), m.vaultId, { name: 'Family', archived: false, items: m.items! });
    await updateVaultOnChain({ account, vaultId: res.vaultId, blob: next, base: m.blob }, { client, sponsor, reader });
    expect(await sponsoredOpsUsed(client, res.owner)).toBe(2);
    // The signing path is unchanged: the edit above verified on-chain (UV + rpIdHash); a second edit too.
    const again = await editVaultBlob(next, await f.prfFor(b.credId, locatorSalt()), m.vaultId, { name: 'Family', archived: true, items: m.items! });
    await updateVaultOnChain({ account, vaultId: res.vaultId, blob: again, base: next }, { client, sponsor, reader });
    expect(await sponsoredOpsUsed(client, res.owner)).toBe(3);
    f.use(0);
    expect((await unlock({ rpId: 'localhost' }, { credentials: f.credentials, reader })).matches[0]).toMatchObject({ name: 'Family', archived: true, version: 3 });
  });

  it('review M1, two tabs: B passes its checks, A saves during B\'s signing tap, B fails with NONCE_CONFLICT and A\'s save stands', async () => {
    const { f, b, client, reader, sponsor, res } = await createOne();
    f.use(1);
    const opened = await unlock({ rpId: 'localhost' }, { credentials: f.credentials, reader });
    const m = opened.matches[0]!;
    const account = await existingVaultAccount({ client, address: m.owner, entryIndex: 1, credId: b.credId, expectedLocator: opened.locator, credentials: f.credentials });
    const fromA = await editVaultBlob(m.blob, await f.prfFor(b.credId, locatorSalt()), m.vaultId, { archived: false, items: [{ label: 'Seed', secret: 'tab A' }] });
    const fromB = await editVaultBlob(m.blob, await f.prfFor(b.credId, locatorSalt()), m.vaultId, { archived: false, items: [{ label: 'Seed', secret: 'tab B' }] });
    const pinned = await sponsoredOpsUsed(client, m.owner);
    // Tab B: its pre-write checks pass (same nonce, same blob); while B waits for its signing tap, tab A saves.
    const err = await updateVaultOnChain(
      { account, vaultId: res.vaultId, blob: fromB, base: m.blob, nonce: BigInt(pinned) },
      { client, sponsor, reader, onSign: async () => void (await updateVaultOnChain({ account, vaultId: res.vaultId, blob: fromA, base: m.blob }, { client, sponsor, reader })) },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(WriteError);
    expect(err.code).toBe('NONCE_CONFLICT');
    const v = (await reader.getVault(res.vaultId))!;
    expect(v.version).toBe(2);
    expect(toHex(v.blob)).toBe(toHex(fromA));
    expect(await sponsoredOpsUsed(client, m.owner)).toBe(pinned + 1);
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
    await addKeyOnChain({ account, vaultId: res.vaultId, blob: added.blob, base: res.blob, newLocator: toHex(added.locator), newPublicKey: c.publicKey, keyCountBefore: 2 }, { client, sponsor, reader });
    expect(await ownerPublicKeyAt(client, res.owner, 2)).toBe(c.publicKey);
    expect(decodeVault((await reader.getVault(res.vaultId))!.blob).keyCount).toBe(3);
    f.use(ci);
    const opened = await unlock({ rpId: 'localhost' }, { credentials: f.credentials, reader });
    expect(opened.matches[0]!.entryIndex).toBe(2);
    expect(opened.matches[0]!.items![0]!.label).toBe('Seed');
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
    const err = await updateVaultOnChain({ account, vaultId: res.vaultId, blob: res.blob, base: res.blob }, { client, sponsor, reader }).catch((e) => e);
    expect(err).toBeInstanceOf(WriteError);
    expect((await reader.getVault(res.vaultId))!.version).toBe(1);
  });

  it('AA-M1: stuffing a key’s locator (40 junk v2 vaults) cannot block a create; the vault still unlocks', async () => {
    const { f, a, b } = await twoKeys();
    const client = makePublicClient(rpc);
    const reader = createRegistryReader(rpc);
    const pa = await f.prfFor(a.credId, locatorSalt());
    const pb = await f.prfFor(b.credId, locatorSalt());
    const locators = [deriveLocator(pa), deriveLocator(pb)];
    const build = buildFor([{ label: 'x', secret: 'y' }], [{ credId: a.credId, prf: pa }, { credId: b.credId, prf: pb }]);
    const target = toHex(locators[1]!);
    for (let i = 0; i < 40; i++) {
      const from = ('0x' + (0x1000 + i).toString(16).padStart(40, '0')) as Hex;
      await junkV2(from, target, i);
    }
    f.use(0);
    const account = await newVaultAccount({ client, owners: [a, b], signerIndex: 0, expectedLocator: locators[0]!, credentials: f.credentials });
    const res = await createVaultOnChain({ account, build }, { client, sponsor: createSponsor(client), reader });
    f.use(1);
    const opened = await unlock({ rpId: 'localhost' }, { credentials: f.credentials, reader });
    expect(opened.matches.map((m) => m.vaultId)).toEqual([res.vaultId]);
    expect(opened.matches[0]!.registry).toBe('v2');
  });

  it('AA-M2: the vaultId is derived from the account, so a copied salt gives the copier a different id', async () => {
    const { res } = await createOne();
    const { deriveVaultIdV2 } = await import('../src/chain/contracts');
    expect(res.vaultId).not.toBe(deriveVaultIdV2('0x00000000000000000000000000000000000a77ac', ('0x' + '00'.repeat(32)) as Hex));
    expect((await createRegistryReader(rpc).vaultOf(res.owner)).toLowerCase()).toBe(res.vaultId.toLowerCase());
  });
});

describe('10.7: vault cloning is neutralised (vaultId bound into the ciphertext)', () => {
  it('a byte-identical clone of the victim blob + locators under an attacker vaultId is never offered', async () => {
    const { f, res, reader, client } = await createOne([{ label: 'Seed', secret: 'victim secret' }]);
    const { createTestClient, createWalletClient, encodeFunctionData, keccak256, toHex: vToHex } = await import('viem');
    const { config } = await import('virtual:cryoshield-config');
    const { deriveVaultIdV2, registryV2Abi } = await import('../src/chain/contracts');
    const chain = { id: 31337, name: 'anvil', nativeCurrency: { name: 'E', symbol: 'E', decimals: 18 }, rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } } } as const;
    const t = createTestClient({ chain, transport: rpc, mode: 'anvil' });
    const w = createWalletClient({ chain, transport: rpc });
    const attacker = '0x00000000000000000000000000000000000a77ac' as Hex;
    await t.impersonateAccount({ address: attacker });
    await t.setBalance({ address: attacker, value: 10n ** 18n });
    const salt = keccak256(vToHex(`clone-${Date.now()}`));
    const cloneId = deriveVaultIdV2(attacker, salt);
    const cloneTx = await w.sendTransaction({
      account: attacker,
      chain,
      to: config.registries[0].address,
      data: encodeFunctionData({ abi: registryV2Abi, functionName: 'createVault', args: [salt, toHex(res.blob), res.locators] }),
    } as never);
    // Wait until the clone is mined and succeeded before asserting on the index.
    const cloneReceipt = await client.waitForTransactionReceipt({ hash: cloneTx });
    expect(cloneReceipt.status).toBe('success');
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

describe('harden-gas-sponsorship: legacy VaultRegistry v1 vaults', () => {
  it('a v1-only vault still unlocks (read-only), and its account is never asked to sign', async () => {
    const { f, a, b } = await twoKeys();
    const reader = createRegistryReader(rpc);
    const pa = await f.prfFor(a.credId, locatorSalt());
    const pb = await f.prfFor(b.credId, locatorSalt());
    const vaultId = keccak256Hex(`legacy-${Date.now()}`);
    const r = await createVaultBlob({ vaultId, rpId: 'localhost', keys: [{ credId: a.credId, prf: pa }, { credId: b.credId, prf: pb }], payload: { archived: false, items: [{ label: 'Old', secret: 'v1 secret' }] } });
    await writeV1('0x00000000000000000000000000000000000b1b1b', vaultId, r.blob, r.locators.map(toHex));
    f.use(1);
    const opened = await unlock({ rpId: 'localhost' }, { credentials: f.credentials, reader });
    expect(opened.matches).toHaveLength(1);
    expect(opened.matches[0]).toMatchObject({ vaultId, registry: 'v1' });
    expect(opened.matches[0]!.items![0]!.secret).toBe('v1 secret');
  });

  it('a stale copy of a v2 vault registered under the same id in v1 is ignored: only the current v2 version opens', async () => {
    const { f, b, client, reader, sponsor, res } = await createOne([{ label: 'Seed', secret: 'old' }]);
    const staleBlob = res.blob; // version 1, still decryptable by the keys
    f.use(1);
    const opened = await unlock({ rpId: 'localhost' }, { credentials: f.credentials, reader });
    const prf = await f.prfFor(b.credId, locatorSalt());
    const newBlob = await editVaultBlob(opened.matches[0]!.blob, prf, res.vaultId, { archived: false, items: [{ label: 'Seed', secret: 'new' }] });
    const account = await existingVaultAccount({ client, address: res.owner, entryIndex: 1, credId: b.credId, expectedLocator: opened.locator, credentials: f.credentials });
    await updateVaultOnChain({ account, vaultId: res.vaultId, blob: newBlob, base: opened.matches[0]!.blob }, { client, sponsor, reader });
    // Replay: the old blob under the SAME vaultId in v1 (v1 accepts caller-chosen ids), under the victim's locators.
    await writeV1('0x00000000000000000000000000000000000a77ad', res.vaultId, staleBlob, res.locators);
    for (const k of [0, 1]) {
      f.use(k);
      const again = await unlock({ rpId: 'localhost' }, { credentials: f.credentials, reader });
      expect(again.matches.map((m) => [m.registry, m.version])).toEqual([['v2', 2]]);
      expect(again.matches[0]!.items![0]!.secret).toBe('new');
    }
  });
});

const anvilChain = { id: 31337, name: 'anvil', nativeCurrency: { name: 'E', symbol: 'E', decimals: 18 }, rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } } } as const;

function keccak256Hex(s: string): Hex {
  return vKeccak(vToHexStr(s));
}

/** A direct (unsponsored) VaultRegistry v1 create from an impersonated EOA: how legacy testnet vaults exist. */
async function writeV1(from: Hex, vaultId: Hex, blob: Uint8Array, locators: readonly Hex[]) {
  const { config } = await import('virtual:cryoshield-config');
  const registryV1Abi = (await import('../../../contracts/abi/VaultRegistry.json')).default;
  const t = createTestClient({ chain: anvilChain, transport: rpc, mode: 'anvil' });
  const w = createWalletClient({ chain: anvilChain, transport: rpc });
  await t.impersonateAccount({ address: from });
  await t.setBalance({ address: from, value: 10n ** 18n });
  const h = await w.sendTransaction({ account: from, chain: anvilChain, to: config.registries.find((r: { version: string }) => r.version === 'v1')!.address, data: vEncode({ abi: registryV1Abi as never, functionName: 'createVault', args: [vaultId, toHex(blob), locators] }) } as never);
  expect((await makePublicClient(rpc).waitForTransactionReceipt({ hash: h })).status).toBe('success');
}

/** A junk VaultRegistry v2 vault from `from` that lists `target` (locator stuffing). */
async function junkV2(from: Hex, target: Hex, i: number) {
  const { config } = await import('virtual:cryoshield-config');
  const { registryV2Abi } = await import('../src/chain/contracts');
  const t = createTestClient({ chain: anvilChain, transport: rpc, mode: 'anvil' });
  const w = createWalletClient({ chain: anvilChain, transport: rpc });
  await t.impersonateAccount({ address: from });
  await t.setBalance({ address: from, value: 10n ** 18n });
  const salt = keccak256Hex(`junk-${Date.now()}-${i}`);
  const h = await w.sendTransaction({ account: from, chain: anvilChain, to: config.registries[0].address, data: vEncode({ abi: registryV2Abi, functionName: 'createVault', args: [salt, '0xdead', [target, vKeccak(salt)]] }) } as never);
  expect((await makePublicClient(rpc).waitForTransactionReceipt({ hash: h })).status).toBe('success');
}

function hexToBytes(h: Hex) {
  return Uint8Array.from(Buffer.from(h.slice(2), 'hex'));
}

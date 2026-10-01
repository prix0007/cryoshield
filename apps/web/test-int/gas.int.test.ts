/** Task 6.6 (local half): gas of create / edit / add-key through EntryPoint v0.6 on anvil (no RIP-7212 precompile). */
import { describe, expect, it } from 'vitest';
import { http, type Hex } from 'viem';
import { locatorSalt } from '@cryoshield/vault-crypto';
import { FakeAuthenticators } from '../test/fixtures/fake-webauthn';
import { enrollKey } from '../src/webauthn';
import { createRegistryReader } from '../src/chain/registry';
import { addKeyToBlob, createVaultBlob, editVaultBlob } from '../src/vault/adapter';
import { existingVaultAccount, makePublicClient, newVaultAccount } from '../src/account/account';
import { addKeyOnChain, createSponsor, createVaultOnChain, updateVaultOnChain } from '../src/account/writes';
import { fromHex, toHex } from '../src/lib/bytes';

const rpc = http('http://127.0.0.1:8545');

describe('gas (6.6)', () => {
  it('measures a 2-key create with a near-max payload, an edit, and an add-key', async () => {
    const f = new FakeAuthenticators();
    f.addKey(); f.addKey(); f.addKey();
    const keys = [];
    for (let i = 0; i < 3; i++) {
      f.use(i);
      keys.push(await enrollKey({ rpId: 'localhost', rpName: 'x', label: `k${i}`, exclude: [] }, f.credentials));
    }
    const [a, b, c] = keys as [typeof keys[0], typeof keys[0], typeof keys[0]];
    const client = makePublicClient(rpc);
    const reader = createRegistryReader(rpc);
    const sponsor = createSponsor(client);
    const items = [{ label: 'Seed', secret: 'x'.repeat(480) }];
    const vid = ('0x' + 'a1'.repeat(32)) as Hex;
    const { blob, locators } = await createVaultBlob({ vaultId: vid, rpId: 'localhost', keys: [{ credId: a.credId, prf: await f.prfFor(a.credId, locatorSalt()) }, { credId: b.credId, prf: await f.prfFor(b.credId, locatorSalt()) }], items });
    f.use(0);
    const acct = await newVaultAccount({ client, owners: [a, b], signerIndex: 0, expectedLocator: locators[0]!, credentials: f.credentials });
    const created = await createVaultOnChain({ account: acct, build: async () => ({ blob, locators: locators.map(toHex) }) }, { client, sponsor, reader, randomId: () => vid });
    const edited = await editVaultBlob(blob, await f.prfFor(a.credId, locatorSalt()), vid, items);
    const acct2 = await existingVaultAccount({ client, address: created.owner, entryIndex: 0, credId: a.credId, expectedLocator: locators[0]!, credentials: f.credentials });
    const up = await updateVaultOnChain({ account: acct2, vaultId: created.vaultId, blob: edited }, { client, sponsor, reader });
    const smaller = await editVaultBlob(edited, await f.prfFor(a.credId, locatorSalt()), vid, [{ label: 'Seed', secret: 'x'.repeat(300) }]);
    const up2 = await updateVaultOnChain({ account: acct2, vaultId: created.vaultId, blob: smaller }, { client, sponsor, reader });
    const added = await addKeyToBlob(smaller, await f.prfFor(a.credId, locatorSalt()), vid, { credId: c.credId, prf: await f.prfFor(c.credId, locatorSalt()) });
    const ak = await addKeyOnChain({ account: acct2, vaultId: created.vaultId, blob: added.blob, newLocator: toHex(added.locator), newPublicKey: c.publicKey, keyCountBefore: 2 }, { client, sponsor, reader });
    const gas = async (h?: Hex) => (await client.getTransactionReceipt({ hash: h! })).gasUsed;
    const out = { createBlobBytes: blob.length, create: await gas(created.txHash), edit: await gas(up.txHash), editSmaller: await gas(up2.txHash), addKeyBlobBytes: added.blob.length, addKey: await gas(ak.txHash) };
    console.info('GAS', JSON.stringify(out, (_, v) => (typeof v === 'bigint' ? Number(v) : v)));
    expect(out.create).toBeGreaterThan(0n);
    expect(fromHex).toBeDefined();
  });
});

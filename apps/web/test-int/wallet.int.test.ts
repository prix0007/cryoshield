/**
 * harden-gas-sponsorship 4.1 (design D8) on anvil: the committed CBSW v1.1 factory bytecode, re-pointed at a
 * NON-Coinbase implementation address (the factory's `implementation` immutable patched), stands in for
 * CryoShieldSmartWalletFactory (same code by design D7). The wrapper must:
 *   - compute the same counterfactual address as that factory's getAddress (and not Coinbase's);
 *   - deploy the account there through a real sponsored user operation, signed by a P-256 key (WebAuthn).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createTestClient, encodeFunctionData, getAddress, http, parseAbi, type Hex } from 'viem';
import { toWebAuthnAccount } from 'viem/account-abstraction';
import { FakeAuthenticators } from '../test/fixtures/fake-webauthn';
import { enrollKey, prfCapturingGetFn } from '../src/webauthn';
import { makePublicClient } from '../src/account/account';
import { createSponsor } from '../src/account/writes';
import { toCryoShieldSmartAccount } from '../src/account/wallet';
import { walletFactoryAbi } from '../src/chain/contracts';
import { smartWalletAbi } from '../src/account/policy';
import { toBase64Url } from '../src/lib/bytes';
import { deriveLocator, locatorSalt } from '@cryoshield/vault-crypto';

const fixtures = JSON.parse(readFileSync(new URL('../e2e/fixtures/chain-fixtures.json', import.meta.url), 'utf8'));
const rpc = http('http://127.0.0.1:8545');
const anvil = createTestClient({ chain: { id: 31337, name: 'anvil', nativeCurrency: { name: 'E', symbol: 'E', decimals: 18 }, rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } } }, transport: rpc, mode: 'anvil' });

const CB_IMPL = (fixtures.cbswImplementation11.address as string).toLowerCase().slice(2);
const OUR_IMPL = getAddress('0x00000000000000000000000000000000c5c5c5c5');
const OUR_FACTORY = getAddress('0x00000000000000000000000000000000c5f0f0f0');
const IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

async function installOurFactory() {
  const factoryCode = (fixtures.cbswFactory11.code as string).toLowerCase();
  expect(factoryCode.split(CB_IMPL).length - 1).toBe(4); // the `implementation` immutable, 4 uses
  await anvil.setCode({ address: OUR_IMPL, bytecode: fixtures.cbswImplementation11.code });
  await anvil.setCode({ address: OUR_FACTORY, bytecode: factoryCode.replaceAll(CB_IMPL, OUR_IMPL.slice(2).toLowerCase()) as Hex });
}

describe('4.1: viem CBSW encoding with a custom factory (design D8)', () => {
  it('matches the custom factory’s getAddress and deploys there via a sponsored, WebAuthn-signed user operation', async () => {
    await installOurFactory();
    const client = makePublicClient(rpc);
    const f = new FakeAuthenticators();
    f.addKey();
    f.addKey();
    f.addKey();
    f.use(0);
    const a = await enrollKey({ rpId: 'localhost', rpName: 'x', label: 'a', exclude: [] }, f.credentials);
    f.use(1);
    const b = await enrollKey({ rpId: 'localhost', rpName: 'x', label: 'b', exclude: [a.credId] }, f.credentials);
    f.use(2);
    const c = await enrollKey({ rpId: 'localhost', rpName: 'x', label: 'c', exclude: [] }, f.credentials);
    f.use(0);
    const expectedLocator = deriveLocator(await f.prfFor(a.credId, locatorSalt()));
    const signer = toWebAuthnAccount({
      credential: { id: toBase64Url(a.credId), publicKey: a.publicKey },
      getFn: prfCapturingGetFn({ expectedLocator, credentials: f.credentials }) as never,
      rpId: 'localhost',
    });
    const other = toWebAuthnAccount({ credential: { id: toBase64Url(b.credId), publicKey: b.publicKey }, rpId: 'localhost' });

    const account = await toCryoShieldSmartAccount({ client, factory: OUR_FACTORY, owners: [signer, other], ownerIndex: 0 });
    const viaOurs = await client.readContract({ address: OUR_FACTORY, abi: walletFactoryAbi, functionName: 'getAddress', args: [[a.publicKey, b.publicKey], 0n] });
    const viaCoinbase = await client.readContract({ address: fixtures.cbswFactory11.address, abi: walletFactoryAbi, functionName: 'getAddress', args: [[a.publicKey, b.publicKey], 0n] });
    expect(account.address).toBe(viaOurs);
    expect(account.address).not.toBe(viaCoinbase);
    expect(await client.getCode({ address: account.address })).toBeUndefined();

    // A sponsorable self call (add-key's addOwnerPublicKey): the initCode deploys the account through OUR factory.
    const x = `0x${c.publicKey.slice(2, 66)}` as Hex;
    const y = `0x${c.publicKey.slice(66)}` as Hex;
    const r = await createSponsor(client).send(account, [
      { to: account.address, value: 0n, data: encodeFunctionData({ abi: smartWalletAbi, functionName: 'addOwnerPublicKey', args: [x, y] }) },
    ]);
    expect(r.success).toBe(true);
    const impl = await client.getStorageAt({ address: account.address, slot: IMPL_SLOT });
    expect(getAddress(`0x${impl!.slice(26)}`)).toBe(OUR_IMPL);
    const owners = parseAbi(['function ownerAtIndex(uint256) view returns (bytes)']);
    expect(await client.readContract({ address: account.address, abi: owners, functionName: 'ownerAtIndex', args: [0n] })).toBe(a.publicKey);
    expect(await client.readContract({ address: account.address, abi: owners, functionName: 'ownerAtIndex', args: [2n] })).toBe(c.publicKey);
  });
});

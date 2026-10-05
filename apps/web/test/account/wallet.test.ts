/**
 * harden-gas-sponsorship 4.1 (design D8): viem's toCoinbaseSmartAccount (viem 2.57.2) hardcodes Coinbase's factory
 * (`factoryAddress[version]`, no parameter), so the app wraps it: same CBSW v1.1 encoding and signing, but the
 * address and initCode come from OUR factory. The anvil proof against real factory bytecode is in
 * test-int/wallet.int.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionData,
  encodeFunctionResult,
  getAddress,
  type Address,
  type Hex,
} from 'viem';
import { toWebAuthnAccount } from 'viem/account-abstraction';
import { toCryoShieldSmartAccount, COINBASE_FACTORY_V11 } from '../../src/account/wallet';
import { walletFactoryAbi } from '../../src/chain/contracts';

const OUR_FACTORY = getAddress('0x00000000000000000000000000000000c5f00001');
const PREDICTED = getAddress('0x1111111111111111111111111111111111111111');
const pk = (b: string) => (`0x${b.repeat(64)}`) as Hex;
const owner = (b: string) => toWebAuthnAccount({ credential: { id: `cred-${b}`, publicKey: pk(b) } });

function chain(deployed = false) {
  const seen: { to: Address; fn: string; args: readonly unknown[] }[] = [];
  const client = createPublicClient({
    chain: { id: 31337, name: 't', nativeCurrency: { name: 'E', symbol: 'E', decimals: 18 }, rpcUrls: { default: { http: ['http://x'] } } },
    transport: custom({
      async request({ method, params }: { method: string; params: any }) {
        if (method === 'eth_chainId') return '0x7a69';
        if (method === 'eth_getCode') return deployed ? '0x6001' : '0x';
        if (method === 'eth_call') {
          const to = getAddress(params[0].to);
          const { functionName, args } = decodeFunctionData({ abi: walletFactoryAbi, data: params[0].data });
          seen.push({ to, fn: functionName, args: args ?? [] });
          if (to !== OUR_FACTORY) throw new Error(`unexpected factory ${to}`);
          return encodeFunctionResult({ abi: walletFactoryAbi, functionName: 'getAddress', result: PREDICTED });
        }
        throw new Error(`unsupported ${method}`);
      },
    }),
  });
  return { client, seen };
}

describe('CryoShield smart account wrapper (4.1, design D8)', () => {
  it('derives the counterfactual address from OUR factory, never Coinbase’s', async () => {
    const { client, seen } = chain();
    const acc = await toCryoShieldSmartAccount({ client, factory: OUR_FACTORY, owners: [owner('aa'), owner('bb')], ownerIndex: 1 });
    expect(acc.address).toBe(PREDICTED);
    expect(await acc.getAddress()).toBe(PREDICTED);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ to: OUR_FACTORY, fn: 'getAddress', args: [[pk('aa'), pk('bb')], 0n] });
    expect(seen.some((s) => s.to === getAddress(COINBASE_FACTORY_V11))).toBe(false);
  });

  it('initCode targets our factory with createAccount(owners in blob order, nonce 0)', async () => {
    const { client } = chain();
    const acc = await toCryoShieldSmartAccount({ client, factory: OUR_FACTORY, owners: [owner('aa'), owner('bb')], ownerIndex: 0 });
    const args = await acc.getFactoryArgs();
    expect(args.factory).toBe(OUR_FACTORY);
    expect(args.factoryData).toBe(encodeFunctionData({ abi: walletFactoryAbi, functionName: 'createAccount', args: [[pk('aa'), pk('bb')], 0n] }));
    expect(acc.factory.address).toBe(OUR_FACTORY);
  });

  it('a deployed account sends no initCode', async () => {
    const { client } = chain(true);
    const acc = await toCryoShieldSmartAccount({ client, factory: OUR_FACTORY, owners: [owner('aa'), owner('bb')], ownerIndex: 0 });
    expect(await acc.getFactoryArgs()).toEqual({ factory: undefined, factoryData: undefined });
  });

  it('a known address (existing vault) needs no factory read', async () => {
    const { client, seen } = chain(true);
    const known = getAddress('0x2222222222222222222222222222222222222222');
    const acc = await toCryoShieldSmartAccount({ client, factory: OUR_FACTORY, owners: [owner('aa')], ownerIndex: 0, address: known });
    expect(acc.address).toBe(known);
    expect(seen).toHaveLength(0);
  });

  it('keeps CBSW v1.1 call encoding (execute / executeBatch)', async () => {
    const { client } = chain();
    const acc = await toCryoShieldSmartAccount({ client, factory: OUR_FACTORY, owners: [owner('aa'), owner('bb')], ownerIndex: 0 });
    const one = await acc.encodeCalls([{ to: OUR_FACTORY, data: '0x01' }]);
    const many = await acc.encodeCalls([{ to: OUR_FACTORY, data: '0x01' }, { to: PREDICTED, data: '0x02' }]);
    expect(one.slice(0, 10)).toBe('0xb61d27f6'); // execute(address,uint256,bytes)
    expect(many.slice(0, 10)).toBe('0x34fcd5be'); // executeBatch((address,uint256,bytes)[])
  });

  it('refuses non-P-256 owners and more than 8 owners (the account would revert at initialize)', async () => {
    const { client } = chain();
    await expect(
      toCryoShieldSmartAccount({ client, factory: OUR_FACTORY, owners: ['0x00000000000000000000000000000000000000aa' as never], ownerIndex: 0 }),
    ).rejects.toThrow(/P-256/);
    const nine = Array.from({ length: 9 }, (_, i) => owner(String(i + 1).padStart(2, '0')));
    await expect(toCryoShieldSmartAccount({ client, factory: OUR_FACTORY, owners: nine, ownerIndex: 0 })).rejects.toThrow(/8/);
    await expect(toCryoShieldSmartAccount({ client, factory: OUR_FACTORY, owners: [owner('aa')], ownerIndex: 1 })).rejects.toThrow(/owner index/);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { concat, decodeFunctionData, encodeErrorResult, encodeFunctionResult, keccak256, pad, type Hex } from 'viem';
import { config } from 'virtual:cryoshield-config';
import { createVaultOnChain, registryError, updateVaultOnChain, WriteError } from '../../src/account/writes';
import { deriveVaultIdV2, registryV2Abi } from '../../src/chain/contracts';

const owner = '0x00000000000000000000000000000000000000aa' as Hex;
const account = { getAddress: async () => owner } as never;
const blob = new Uint8Array([1, 2, 3]);
const okClient = { getChainId: async () => 31337, call: vi.fn(async () => ({ data: '0x' })) } as never;
const reader = (b: Uint8Array | null) => ({ getVault: async (vaultId: Hex) => (b ? { vaultId, owner, blob: b, version: 2, registry: 'v2' } : null) }) as never;
const revert = (name: string, args: unknown[]) => encodeErrorResult({ abi: registryV2Abi, errorName: name, args } as never);
const locs = [('0x' + '44'.repeat(32)) as Hex, ('0x' + '55'.repeat(32)) as Hex];

/** A public client whose eth_call answers vaultIdFor like the registry, and records every call. */
function registryClient(opts: { vaultIdFor?: (o: Hex, s: Hex) => Hex; revertWith?: Hex } = {}) {
  const calls: { to: Hex; fn: string; args: readonly unknown[] }[] = [];
  return {
    calls,
    client: {
      getChainId: async () => 31337,
      call: vi.fn(async ({ to, data }: { to: Hex; data: Hex }) => {
        const d = decodeFunctionData({ abi: registryV2Abi, data });
        calls.push({ to, fn: d.functionName, args: d.args ?? [] });
        if (d.functionName === 'vaultIdFor') {
          const [o, s] = d.args as [Hex, Hex];
          return { data: encodeFunctionResult({ abi: registryV2Abi, functionName: 'vaultIdFor', result: (opts.vaultIdFor ?? deriveVaultIdV2)(o, s) }) };
        }
        if (opts.revertWith) {
          const { BaseError } = await import('viem');
          const data = opts.revertWith;
          throw new (class extends BaseError {
            data = data;
            constructor() {
              super('reverted');
            }
          })();
        }
        return { data: '0x' };
      }),
    } as never,
  };
}

describe('registry v2 error mapping', () => {
  it.each([
    ['OwnerAlreadyHasVault', [owner], 'ALREADY_HAS_VAULT'],
    ['TooManyLocators', [9n], 'TOO_MANY_KEYS'],
    ['InvalidBlobSize', [2000n], 'TOO_LARGE'],
    ['NotVaultOwner', ['0x' + '11'.repeat(32), owner], 'NOT_OWNER'],
    ['DuplicateLocator', ['0x' + '11'.repeat(32)], 'DUPLICATE_KEY'],
    ['TooManyIds', [33n], 'REVERTED'],
  ])('%s -> %s', (name, args, code) => {
    expect(registryError(revert(name, args)).code).toBe(code);
  });
  it('unknown data -> REVERTED', () => expect(registryError('0xdeadbeef').code).toBe('REVERTED'));
  it('v1-only errors (LocatorFull, VaultIdTaken) no longer exist for writes', () => {
    const names = registryV2Abi.map((i) => (i as { name?: string }).name);
    expect(names).not.toContain('LocatorFull');
    expect(names).not.toContain('VaultIdTaken');
  });
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

  it('updates target VaultRegistry v2', async () => {
    const sponsor = { send: vi.fn(async () => ({ userOpHash: '0x01' as Hex, success: true })) };
    await updateVaultOnChain({ account, vaultId: ('0x' + '33'.repeat(32)) as Hex, blob }, { client: okClient, sponsor, reader: reader(blob) });
    const calls = (sponsor.send.mock.calls[0] as unknown as [unknown, { to: Hex }[]])[1];
    expect(calls.map((c) => c.to.toLowerCase())).toEqual([config.registryV2.address.toLowerCase()]);
  });
});

describe('harden-gas-sponsorship 5.2: salt-based create on VaultRegistry v2', () => {
  it('vaultId = keccak256(abi.encode(owner, salt)): a known answer computed independently', () => {
    const salt = ('0x' + '07'.repeat(32)) as Hex;
    expect(deriveVaultIdV2(owner, salt)).toBe(keccak256(concat([pad(owner, { size: 32 }), salt])));
  });

  const vectors = (() => {
    const v = JSON.parse(readFileSync(join(__dirname, '../../../../packages/vault-crypto/test-vectors/v1.json'), 'utf8')) as Record<string, unknown>;
    return (v.vaultIdDerivation as { cases?: { owner: Hex; salt: Hex; vaultId: Hex }[] } | { owner: Hex; salt: Hex; vaultId: Hex }[] | undefined) ?? null;
  })();
  const cases = vectors ? (Array.isArray(vectors) ? vectors : (vectors.cases ?? [])) : [];
  it.skipIf(cases.length === 0)('matches every vaultIdDerivation vector (packages/vault-crypto task 3.1)', () => {
    for (const c of cases) expect(deriveVaultIdV2(c.owner, c.salt)).toBe(c.vaultId.toLowerCase());
  });

  it('builds once under the derived id, sends createVault(salt, blob, locators) to v2, and never retries', async () => {
    const { client, calls } = registryClient();
    const sponsor = { send: vi.fn(async () => ({ userOpHash: '0x01' as Hex, success: true })) };
    const salt = ('0x' + '07'.repeat(32)) as Hex;
    const built: Hex[] = [];
    const r = await createVaultOnChain(
      { account, build: async (vaultId: Hex) => (built.push(vaultId), { blob, locators: locs }) },
      { client, sponsor, reader: reader(blob), randomSalt: () => salt },
    );
    expect(built).toEqual([deriveVaultIdV2(owner, salt)]);
    expect(r.vaultId).toBe(deriveVaultIdV2(owner, salt));
    const sent = (sponsor.send.mock.calls[0] as unknown as [unknown, { to: Hex; data: Hex }[]])[1];
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to.toLowerCase()).toBe(config.registryV2.address.toLowerCase());
    const d = decodeFunctionData({ abi: registryV2Abi, data: sent[0]!.data });
    expect(d.functionName).toBe('createVault');
    expect(d.args).toEqual([salt, '0x010203', locs]);
    expect(calls.map((c) => c.fn)).toEqual(['vaultIdFor', 'createVault']);
  });

  it('an included create that reverts is reported once; no second attempt under another id', async () => {
    const { client } = registryClient();
    const sponsor = { send: vi.fn(async () => ({ userOpHash: '0x01' as Hex, success: false, reason: revert('OwnerAlreadyHasVault', [owner]) })) };
    const build = vi.fn(async () => ({ blob, locators: locs }));
    const err = await createVaultOnChain({ account, build }, { client, sponsor, reader: reader(blob) }).catch((e) => e);
    expect(err).toBeInstanceOf(WriteError);
    expect(err.code).toBe('ALREADY_HAS_VAULT');
    expect(sponsor.send).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('a preflight revert stops before any signing tap or send', async () => {
    const { client } = registryClient({ revertWith: revert('TooManyLocators', [9n]) });
    const sponsor = { send: vi.fn() };
    const onSign = vi.fn();
    const err = await createVaultOnChain({ account, build: async () => ({ blob, locators: locs }) }, { client, sponsor: sponsor as never, reader: reader(blob), onSign }).catch((e) => e);
    expect(err.code).toBe('TOO_MANY_KEYS');
    expect(onSign).not.toHaveBeenCalled();
    expect(sponsor.send).not.toHaveBeenCalled();
  });

  it('refuses to encrypt or sign when the registry derives a different vaultId (derivation drift)', async () => {
    const { client } = registryClient({ vaultIdFor: () => ('0x' + 'ee'.repeat(32)) as Hex });
    const sponsor = { send: vi.fn() };
    const build = vi.fn(async () => ({ blob, locators: locs }));
    const err = await createVaultOnChain({ account, build }, { client, sponsor: sponsor as never, reader: reader(blob) }).catch((e) => e);
    expect(err.code).toBe('REVERTED');
    expect(build).not.toHaveBeenCalled();
    expect(sponsor.send).not.toHaveBeenCalled();
  });

  it('two creates use independent random salts', async () => {
    const ids: Hex[] = [];
    for (let i = 0; i < 2; i++) {
      const { client } = registryClient();
      const sponsor = { send: vi.fn(async () => ({ userOpHash: '0x01' as Hex, success: true })) };
      ids.push((await createVaultOnChain({ account, build: async () => ({ blob, locators: locs }) }, { client, sponsor, reader: reader(blob) })).vaultId);
    }
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe('add-key asserts nextOwnerIndex == keyCount before signing (review fix 6)', () => {
  it('refuses when the account owner count does not match the blob', async () => {
    const { addKeyOnChain } = await import('../../src/account/writes');
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
  it('proceeds when nextOwnerIndex == keyCount, with addLocators + updateVault on v2', async () => {
    const { addKeyOnChain } = await import('../../src/account/writes');
    const sponsor = { send: vi.fn(async () => ({ userOpHash: '0x01' as Hex, success: true })) };
    const client = { getChainId: async () => 31337, call: vi.fn(async () => ({ data: '0x' })), readContract: vi.fn(async () => 2n) } as never;
    const r = await addKeyOnChain(
      { account, vaultId: ('0x' + '33'.repeat(32)) as Hex, blob, newLocator: ('0x' + '44'.repeat(32)) as Hex, newPublicKey: ('0x' + 'aa'.repeat(64)) as Hex, keyCountBefore: 2 },
      { client, sponsor: sponsor as never, reader: reader(blob) },
    );
    expect(r.version).toBe(2);
    const sent = (sponsor.send.mock.calls[0] as unknown as [unknown, { to: Hex }[]])[1];
    expect(sent.map((c) => c.to.toLowerCase())).toEqual([owner, config.registryV2.address.toLowerCase(), config.registryV2.address.toLowerCase()]);
  });
});

/**
 * harden-gas-sponsorship 2.2 (design D5): through the real viem bundler client and permissionless Pimlico client,
 * with a stubbed bundler endpoint. Every paymaster request carries { sponsorshipPolicyId }; a balance error and a
 * policy-limit error both become SPONSORSHIP_REFUSED, nothing is signed and no user operation is sent.
 */
describe('sponsorship refusal (2.2)', () => {
  afterEach(() => vi.unstubAllGlobals());

  async function attempt(refuseAt: 'pm_getPaymasterStubData' | 'pm_getPaymasterData', message: string) {
    const { createPublicClient, custom, encodeFunctionResult: efr, getAddress } = await import('viem');
    const { toWebAuthnAccount, entryPoint06Abi } = await import('viem/account-abstraction');
    const { createSponsor } = await import('../../src/account/writes');
    const { toCryoShieldSmartAccount } = await import('../../src/account/wallet');
    const { walletFactoryAbi } = await import('../../src/chain/contracts');
    const sender = getAddress('0x1111111111111111111111111111111111111111');
    const methods: { method: string; params: unknown[] }[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      const one = (m: { id: number; method: string; params: unknown[] }) => {
        methods.push(m);
        const ok = (result: unknown) => ({ jsonrpc: '2.0', id: m.id, result });
        if (m.method === refuseAt) return { jsonrpc: '2.0', id: m.id, error: { code: -32603, message } };
        switch (m.method) {
          case 'eth_chainId':
            return ok('0x7a69');
          case 'pimlico_getUserOperationGasPrice':
            return ok({ slow: { maxFeePerGas: '0x1', maxPriorityFeePerGas: '0x1' }, standard: { maxFeePerGas: '0x1', maxPriorityFeePerGas: '0x1' }, fast: { maxFeePerGas: '0x1', maxPriorityFeePerGas: '0x1' } });
          case 'pm_getPaymasterStubData':
            return ok({ paymasterAndData: '0x' + '12'.repeat(20) });
          case 'eth_estimateUserOperationGas':
            return ok({ preVerificationGas: '0x1', verificationGasLimit: '0x1', callGasLimit: '0x1' });
          default:
            return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `unexpected ${m.method}` } };
        }
      };
      const out = Array.isArray(body) ? body.map(one) : one(body);
      return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
    });
    const client = createPublicClient({
      chain: { id: 31337, name: 't', nativeCurrency: { name: 'E', symbol: 'E', decimals: 18 }, rpcUrls: { default: { http: ['http://rpc.invalid'] } } },
      transport: custom({
        async request({ method, params }: { method: string; params: any }) {
          if (method === 'eth_chainId') return '0x7a69';
          if (method === 'eth_getCode') return '0x';
          if (method === 'eth_call') {
            if (params[0].to.toLowerCase() === config.wallet.factory.toLowerCase()) return efr({ abi: walletFactoryAbi, functionName: 'getAddress', result: sender });
            return efr({ abi: entryPoint06Abi, functionName: 'getNonce', result: 0n });
          }
          throw new Error(`unsupported ${method}`);
        },
      }),
    });
    const getFn = vi.fn();
    const owner0 = toWebAuthnAccount({ credential: { id: 'c', publicKey: ('0x' + 'ab'.repeat(64)) as Hex }, getFn, rpId: 'localhost' });
    const acc = await toCryoShieldSmartAccount({ client: client as never, factory: config.wallet.factory, owners: [owner0], ownerIndex: 0 });
    const { encodeFunctionData } = await import('viem');
    const calls = [{ to: config.registryV2.address, value: 0n, data: encodeFunctionData({ abi: registryV2Abi, functionName: 'updateVault', args: [('0x' + '33'.repeat(32)) as Hex, '0x01'] }) }];
    const err = await createSponsor(client as never, 'http://bundler.invalid/rpc', 'sp_test_policy').send(acc, calls).catch((e) => e);
    return { err, methods, getFn };
  }

  it.each([
    ['pm_getPaymasterStubData', 'Insufficient balance: please top up your Pimlico balance'],
    ['pm_getPaymasterData', 'User operation rejected by sponsorship policy: limit reached'],
  ] as const)('%s refusal "%s" -> SPONSORSHIP_REFUSED, nothing signed or sent', async (at, message) => {
    const { err, methods, getFn } = await attempt(at, message);
    expect(err).toBeInstanceOf(WriteError);
    expect(err.code).toBe('SPONSORSHIP_REFUSED');
    expect(getFn).not.toHaveBeenCalled();
    expect(methods.map((m) => m.method)).not.toContain('eth_sendUserOperation');
    const pm = methods.filter((m) => m.method.startsWith('pm_'));
    expect(pm.length).toBeGreaterThan(0);
    for (const m of pm) expect(m.params[3]).toEqual({ sponsorshipPolicyId: 'sp_test_policy' });
  });
});

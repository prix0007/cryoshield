import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { concat, decodeFunctionData, encodeErrorResult, encodeFunctionResult, getAddress, keccak256, pad, type Hex } from 'viem';
import { config } from 'virtual:cryoshield-config';
import { createVaultOnChain, registryError, updateVaultOnChain, WriteError } from '../../src/account/writes';
import { deriveVaultIdV2, registryV2Abi } from '../../src/chain/contracts';

const owner = '0x00000000000000000000000000000000000000aa' as Hex;
const account = { getAddress: async () => owner } as never;
const blob = new Uint8Array([1, 2, 3]);
const okClient = { getChainId: async () => 31337, call: vi.fn(async () => ({ data: '0x' })), readContract: vi.fn(async () => 5n) } as never;
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
    const r = await updateVaultOnChain({ account, vaultId: ('0x' + '33'.repeat(32)) as Hex, blob, base: blob }, { client: okClient, sponsor, reader: reader(blob) });
    expect(r.version).toBe(2);
    await expect(updateVaultOnChain({ account, vaultId: ('0x' + '33'.repeat(32)) as Hex, blob, base: new Uint8Array([9]) }, { client: okClient, sponsor, reader: reader(new Uint8Array([9])) })).rejects.toMatchObject({ code: 'NOT_CONFIRMED' });
  });

  it('an included-but-reverted operation is REVERTED (nothing saved)', async () => {
    const sponsor = { send: vi.fn(async () => ({ userOpHash: '0x01' as Hex, success: false, reason: '0x' as Hex })) };
    await expect(updateVaultOnChain({ account, vaultId: ('0x' + '33'.repeat(32)) as Hex, blob, base: blob }, { client: okClient, sponsor, reader: reader(blob) })).rejects.toMatchObject({ code: 'REVERTED' });
  });

  it('updates target VaultRegistry v2', async () => {
    const sponsor = { send: vi.fn(async () => ({ userOpHash: '0x01' as Hex, success: true })) };
    await updateVaultOnChain({ account, vaultId: ('0x' + '33'.repeat(32)) as Hex, blob, base: blob }, { client: okClient, sponsor, reader: reader(blob) });
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
  // The vector file stores hex without 0x (the v1.json convention); accept either.
  const hex = (h: string) => (`0x${h.replace(/^0x/i, '').toLowerCase()}`) as Hex;
  it('matches every vaultIdDerivation vector (packages/vault-crypto task 3.1; the vector is required, never skipped)', () => {
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) expect(deriveVaultIdV2(getAddress(hex(c.owner)), hex(c.salt))).toBe(hex(c.vaultId));
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
      { account, vaultId: ('0x' + '33'.repeat(32)) as Hex, blob, base: blob, newLocator: ('0x' + '44'.repeat(32)) as Hex, newPublicKey: ('0x' + 'aa'.repeat(64)) as Hex, keyCountBefore: 2 },
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
      { account, vaultId: ('0x' + '33'.repeat(32)) as Hex, blob, base: blob, newLocator: ('0x' + '44'.repeat(32)) as Hex, newPublicKey: ('0x' + 'aa'.repeat(64)) as Hex, keyCountBefore: 2 },
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

  async function attempt(refuseAt: 'pm_getPaymasterStubData' | 'pm_getPaymasterData' | 'eth_estimateUserOperationGas' | 'eth_sendUserOperation', message: string, nonce?: bigint) {
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
    const err = await createSponsor(client as never, 'http://bundler.invalid/rpc', 'sp_test_policy').send(acc, calls, undefined, nonce).catch((e) => e);
    return { err, methods, getFn };
  }

  it.each([
    ['pm_getPaymasterStubData', 'AA25 invalid account nonce'],
    ['eth_estimateUserOperationGas', 'UserOperation reverted during simulation with reason: AA25 invalid account nonce'],
  ] as const)('a nonce conflict at %s (another save at the same moment) -> NONCE_CONFLICT, not "paused"', async (at, message) => {
    const { err } = await attempt(at, message);
    expect(err).toBeInstanceOf(WriteError);
    expect(err.code).toBe('NONCE_CONFLICT');
  });

  it('a pinned nonce is what the user operation carries (never re-read at send time)', async () => {
    const { methods } = await attempt('pm_getPaymasterData', 'stop here', 7n);
    const stub = methods.find((m) => m.method === 'pm_getPaymasterStubData')!;
    expect((stub.params[0] as { nonce: string }).nonce).toBe('0x7');
  });

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

/** vault-list-labels-archive 2.5 (design D8, D10). */
describe('every update starts from the current blob (STALE)', () => {
  const vaultId = ('0x' + '33'.repeat(32)) as Hex;
  const base = new Uint8Array([7, 7, 7]);
  /** A reader that answers `first` to the staleness read and `blob` afterwards (the confirmation read-back). */
  const seq = (first: Uint8Array | null) => {
    let n = 0;
    return {
      getVault: async (id: Hex) => {
        const b = n++ === 0 ? first : blob;
        return b ? { vaultId: id, owner, blob: b, version: 2, registry: 'v2' } : null;
      },
    } as never;
  };

  it('assertCurrent passes on the same blob and throws STALE on another blob or none', async () => {
    const { assertCurrent } = await import('../../src/account/writes');
    await expect(assertCurrent({ reader: reader(base), client: okClient }, { vaultId, base, owner })).resolves.toBe(5n);
    await expect(assertCurrent({ reader: reader(new Uint8Array([7, 7, 8])), client: okClient }, { vaultId, base, owner })).rejects.toMatchObject({ code: 'STALE' });
    await expect(assertCurrent({ reader: reader(null), client: okClient }, { vaultId, base, owner })).rejects.toMatchObject({ code: 'STALE' });
  });

  it('reads EntryPoint.getNonce(owner, 0) BEFORE the vault, and is STALE when the nonce moved since the session pinned it', async () => {
    const { assertCurrent } = await import('../../src/account/writes');
    const order: string[] = [];
    const client = { readContract: vi.fn(async (a: { functionName: string; args: unknown[] }) => (order.push(a.functionName), expect(a.args).toEqual([owner, 0n]), 6n)) };
    const r = { getVault: async (id: Hex) => (order.push('getVault'), { vaultId: id, owner, blob: base, version: 2, registry: 'v2' }) };
    await expect(assertCurrent({ reader: r as never, client: client as never }, { vaultId, base, owner, nonce: 6n })).resolves.toBe(6n);
    expect(order).toEqual(['getNonce', 'getVault']);
    await expect(assertCurrent({ reader: r as never, client: client as never }, { vaultId, base, owner, nonce: 5n })).rejects.toMatchObject({ code: 'STALE' });
  });

  it('update: the nonce read before the vault is pinned into the user operation', async () => {
    const sponsor = { send: vi.fn(async () => ({ userOpHash: '0x01' as Hex, success: true })) };
    await updateVaultOnChain({ account, vaultId, blob, base }, { client: okClient, sponsor, reader: seq(base) });
    expect((sponsor.send.mock.calls[0] as unknown as unknown[])[3]).toBe(5n);
  });

  it('update: a session-pinned nonce that no longer matches is STALE before onSign', async () => {
    const onSign = vi.fn();
    const sponsor = { send: vi.fn() };
    const err = await updateVaultOnChain({ account, vaultId, blob, base, nonce: 4n }, { client: okClient, sponsor: sponsor as never, reader: seq(base), onSign }).catch((e) => e);
    expect(err.code).toBe('STALE');
    expect(onSign).not.toHaveBeenCalled();
    expect(sponsor.send).not.toHaveBeenCalled();
  });

  it('update: STALE before onSign and before anything is sent', async () => {
    const onSign = vi.fn();
    const sponsor = { send: vi.fn() };
    const err = await updateVaultOnChain({ account, vaultId, blob, base }, { client: okClient, sponsor: sponsor as never, reader: seq(new Uint8Array([1])), onSign }).catch((e) => e);
    expect(err).toBeInstanceOf(WriteError);
    expect(err.code).toBe('STALE');
    expect(onSign).not.toHaveBeenCalled();
    expect(sponsor.send).not.toHaveBeenCalled();
  });

  it('update: proceeds when the chain still has the base blob', async () => {
    const sponsor = { send: vi.fn(async () => ({ userOpHash: '0x01' as Hex, success: true })) };
    const r = await updateVaultOnChain({ account, vaultId, blob, base }, { client: okClient, sponsor, reader: seq(base) });
    expect(r.blob).toBe(blob);
  });

  it('add key: STALE before the owner check, onSign and sending', async () => {
    const { addKeyOnChain } = await import('../../src/account/writes');
    const onSign = vi.fn();
    const sponsor = { send: vi.fn() };
    const client = { getChainId: async () => 31337, call: vi.fn(async () => ({ data: '0x' })), readContract: vi.fn(async () => 2n) };
    const err = await addKeyOnChain(
      { account, vaultId, blob, base, newLocator: ('0x' + '44'.repeat(32)) as Hex, newPublicKey: ('0x' + 'aa'.repeat(64)) as Hex, keyCountBefore: 2 },
      { client: client as never, sponsor: sponsor as never, reader: seq(null), onSign },
    ).catch((e) => e);
    expect(err.code).toBe('STALE');
    expect(client.readContract.mock.calls.map((c) => (c as unknown as [{ functionName: string }])[0].functionName)).toEqual(['getNonce']); // never nextOwnerIndex
    expect(onSign).not.toHaveBeenCalled();
    expect(sponsor.send).not.toHaveBeenCalled();
  });
});

describe('nonce conflicts (D10 amendment: one nonce key)', () => {
  it('isNonceConflict finds AA25 anywhere in the cause chain, and nothing else', async () => {
    const { isNonceConflict } = await import('../../src/account/writes');
    expect(isNonceConflict(new Error('outer', { cause: { details: 'AA25 invalid account nonce' } }))).toBe(true);
    expect(isNonceConflict({ shortMessage: 'x', cause: { shortMessage: 'invalid account nonce' } })).toBe(true);
    expect(isNonceConflict(new Error('AA21 didn\'t pay prefund'))).toBe(false);
    expect(isNonceConflict(new Error('Insufficient balance'))).toBe(false);
  });

  it('isNonceConflict ignores the full message and anything that only looks like AA25 (review M4)', async () => {
    const { isNonceConflict } = await import('../../src/account/writes');
    const calldata = '0x' + '00'.repeat(10) + 'aa25' + 'ff'.repeat(10);
    expect(isNonceConflict({ shortMessage: 'Execution reverted', details: `data: ${calldata}` })).toBe(false);
    expect(isNonceConflict({ shortMessage: 'x', details: '0xAA2512' })).toBe(false); // not a word
    expect(isNonceConflict(new Error(`AA25 invalid account nonce ${calldata}`))).toBe(false); // only shortMessage/details count
    expect(isNonceConflict({ details: 'FailedOp: ["0","AA25 invalid account nonce"]' })).toBe(true);
  });

  it('the app says "try again", never "Saving is paused"', async () => {
    const { messageFor } = await import('../../src/ui/operations');
    const { S } = await import('../../src/ui/strings');
    expect(messageFor(new WriteError('NONCE_CONFLICT'))).toBe(S.save.nonceConflict);
    expect(S.save.nonceConflict).not.toBe(S.save.paused);
    expect(S.save.nonceConflict).toMatch(/a previous save may still be finishing/);
    expect(S.save.nonceConflict).toMatch(/wait a minute, then try again/i);
  });
});

describe('testnet save budget (D10)', () => {
  it('sponsoredOpsUsed reads EntryPoint.getNonce(owner, 0)', async () => {
    const { sponsoredOpsUsed } = await import('../../src/account/writes');
    const { entryPoint06Address } = await import('viem/account-abstraction');
    const readContract = vi.fn(async () => 43n);
    expect(await sponsoredOpsUsed({ readContract } as never, owner)).toBe(43);
    const arg = (readContract.mock.calls[0] as unknown as [{ address: Hex; functionName: string; args: unknown[] }])[0];
    expect(arg.address).toBe(entryPoint06Address);
    expect(arg.functionName).toBe('getNonce');
    expect(arg.args).toEqual([owner, 0n]);
  });

  it.each([
    [0, 50],
    [43, 7],
    [50, 0],
    [61, 0],
  ])('nonce %i leaves about %i free saves', async (nonce, left) => {
    const { savesLeft } = await import('../../src/account/budget');
    expect(savesLeft(nonce)).toBe(left);
  });
});

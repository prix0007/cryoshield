/**
 * Sponsored vault writes (spec sponsored-vault-writes). Every write:
 *   1. builds registry (and, for add-key, self addOwnerPublicKey) calls;
 *   2. checks them against the client-side sponsorship allowlist (policy.ts);
 *   3. preflights each registry call with eth_call FROM the account address (decodes custom errors before any tap);
 *   4. sends ONE user operation through the configured private bundler endpoint with the sponsorship-policy
 *      paymaster context. There is never an unsponsored fallback;
 *   5. reports success only after a successful receipt AND a public-RPC read-back equal to the submitted blob.
 */
import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  encodeFunctionData,
  http,
  type Hex,
  type PublicClient,
} from 'viem';
import {
  createBundlerClient,
  entryPoint06Address,
  type SmartAccount,
} from 'viem/account-abstraction';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { config, registryAbi } from '../config';
import { bytesEqual, randomBytes, toHex } from '../lib/bytes';
import type { RegistryReader } from '../chain/registry';
import { findKeyError, KeyError } from '../webauthn';
import { ensureChain } from '../chain/guard';
import { assertSponsorableCallData, assertSponsorableCalls, PolicyError, smartWalletAbi, type Call } from './policy';

export type WriteErrorCode =
  | 'SPONSORSHIP_REFUSED' // paymaster policy refused (cap reached, outside policy)
  | 'LOCATOR_FULL' // a key's locator already lists 16 vaults (possibly front-run): enroll a fresh credential
  | 'VAULT_ID_TAKEN' // two random vaultIds collided / were front-run
  | 'ALREADY_HAS_VAULT'
  | 'TOO_MANY_KEYS'
  | 'TOO_LARGE'
  | 'NOT_OWNER'
  | 'DUPLICATE_KEY'
  | 'REVERTED' // included, inner call reverted: nothing saved
  | 'NOT_CONFIRMED' // receipt ok but read-back differs / timed out
  | 'KEY' // WebAuthn problem during signing (see .keyError)
  | 'POLICY' // our own allowlist refused the call (programming error)
  | 'OWNER_MISMATCH' // account owners don't line up with the blob's entries (owner index == entry index)
  | 'NETWORK';

export class WriteError extends Error {
  override name = 'WriteError';
  constructor(
    readonly code: WriteErrorCode,
    readonly detail: { locator?: Hex; keyError?: KeyError; cause?: unknown } = {},
  ) {
    super(code);
  }
}

const REGISTRY_ERROR_CODES: Record<string, WriteErrorCode> = {
  VaultIdTaken: 'VAULT_ID_TAKEN',
  OwnerAlreadyHasVault: 'ALREADY_HAS_VAULT',
  LocatorFull: 'LOCATOR_FULL',
  TooManyLocators: 'TOO_MANY_KEYS',
  TooFewLocators: 'REVERTED',
  InvalidBlobSize: 'TOO_LARGE',
  NotVaultOwner: 'NOT_OWNER',
  DuplicateLocator: 'DUPLICATE_KEY',
  ZeroLocator: 'REVERTED',
  ZeroVaultId: 'REVERTED',
};

/** Maps registry revert data (custom error) to a WriteError. */
export function registryError(data: Hex | undefined): WriteError {
  if (data && data.length >= 10) {
    try {
      const e = decodeErrorResult({ abi: registryAbi, data });
      const code = REGISTRY_ERROR_CODES[e.errorName] ?? 'REVERTED';
      const locator = e.errorName === 'LocatorFull' ? (e.args?.[0] as Hex) : undefined;
      return new WriteError(code, locator ? { locator } : {});
    } catch {
      /* not a registry error */
    }
  }
  return new WriteError('REVERTED');
}

function revertData(e: unknown): Hex | undefined {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (r?.raw) return r.raw;
    const withData = e.walk((x) => typeof (x as { data?: unknown }).data === 'string') as { data?: Hex } | null;
    if (withData?.data) return withData.data;
  }
  return undefined;
}

/** eth_call each registry call from the account address; throws the decoded registry error. */
export async function preflight(client: PublicClient, from: Hex, calls: readonly Call[]): Promise<void> {
  await ensureChain(client);
  for (const c of calls) {
    if (c.to.toLowerCase() !== config.registry.address.toLowerCase()) continue;
    try {
      await client.call({ account: from, to: c.to, data: c.data });
    } catch (e) {
      const data = revertData(e);
      if (data) throw registryError(data);
      throw new WriteError('NETWORK', { cause: e });
    }
  }
}

export interface Sponsor {
  send(account: SmartAccount, calls: readonly Call[]): Promise<{ userOpHash: Hex; success: boolean; reason?: Hex; txHash?: Hex }>;
}

/** Bundler + ERC-7677 paymaster (Pimlico in production; the dev bundler in E2E). */
export function createSponsor(client: PublicClient, bundlerUrl = config.bundlerUrl, policyId = config.sponsorshipPolicyId): Sponsor {
  const pimlico = createPimlicoClient({
    transport: http(bundlerUrl, { timeout: 30_000 }),
    entryPoint: { address: entryPoint06Address, version: '0.6' },
  });
  const bundlerChain = { getChainId: async () => Number(await pimlico.request({ method: 'eth_chainId' } as never)) };
  return {
    async send(account, calls) {
      // The bundler/paymaster must serve the configured chain too (checked once per session).
      await ensureChain(bundlerChain, config.chainId, 'bundler');
      const address = await account.getAddress();
      assertSponsorableCalls(calls, address);
      const guard = <T extends { callData: Hex; sender: Hex }>(p: T) => {
        // The exact callData that will be signed must still pass the allowlist.
        assertSponsorableCallData(p.callData, p.sender);
      };
      const paymaster = {
        async getPaymasterStubData(p: Parameters<typeof pimlico.getPaymasterStubData>[0]) {
          guard(p as never);
          try {
            return await pimlico.getPaymasterStubData(p);
          } catch (e) {
            throw new WriteError('SPONSORSHIP_REFUSED', { cause: e });
          }
        },
        async getPaymasterData(p: Parameters<typeof pimlico.getPaymasterData>[0]) {
          guard(p as never);
          try {
            return await pimlico.getPaymasterData(p);
          } catch (e) {
            throw new WriteError('SPONSORSHIP_REFUSED', { cause: e });
          }
        },
      };
      const bundler = createBundlerClient({
        account,
        client,
        transport: http(bundlerUrl, { timeout: 60_000 }),
        paymaster,
        paymasterContext: { sponsorshipPolicyId: policyId },
        userOperation: {
          estimateFeesPerGas: async () => (await pimlico.getUserOperationGasPrice()).fast,
        },
      });
      let userOpHash: Hex;
      try {
        userOpHash = await bundler.sendUserOperation({ calls: calls.map((c) => ({ to: c.to, value: 0n, data: c.data })) });
      } catch (e) {
        throw classify(e);
      }
      try {
        const r = await bundler.waitForUserOperationReceipt({ hash: userOpHash, timeout: 120_000, pollingInterval: 1_000 });
        const out: { userOpHash: Hex; success: boolean; reason?: Hex; txHash?: Hex } = {
          userOpHash,
          success: r.success,
          txHash: r.receipt.transactionHash,
        };
        if (r.reason) out.reason = r.reason as Hex;
        return out;
      } catch (e) {
        throw new WriteError('NOT_CONFIRMED', { cause: e });
      }
    },
  };
}

function classify(e: unknown): WriteError {
  if (e instanceof WriteError) return e;
  let cur: unknown = e;
  for (let i = 0; i < 10 && cur; i++) {
    if (cur instanceof WriteError) return cur;
    if (cur instanceof PolicyError) return new WriteError('POLICY', { cause: cur });
    cur = (cur as { cause?: unknown }).cause;
  }
  const ke = findKeyError(e);
  if (ke) return new WriteError('KEY', { keyError: ke, cause: e });
  return new WriteError('NETWORK', { cause: e });
}

/** Decodes the inner revert of a failed (included) user operation. */
function revertOf(reason: Hex | undefined): WriteError {
  return registryError(reason);
}

async function confirm(reader: RegistryReader, vaultId: Hex, owner: Hex, blob: Uint8Array) {
  const v = await reader.getVault(vaultId);
  if (!v || v.owner.toLowerCase() !== owner.toLowerCase() || !bytesEqual(v.blob, blob)) throw new WriteError('NOT_CONFIRMED');
  return v;
}

export interface WriteResult {
  vaultId: Hex;
  owner: Hex;
  version: number;
  blob: Uint8Array;
  userOpHash: Hex;
  txHash?: Hex;
  locators: Hex[];
}

export interface WriteDeps {
  client: PublicClient;
  sponsor: Sponsor;
  reader: RegistryReader;
  /** Called right before each signing tap so the UI can say "touch your key" (and may wait for the user). */
  onSign?: () => void | Promise<void>;
  randomId?: () => Hex;
}

const randomVaultId = () => toHex(randomBytes(32));

function createCall(vaultId: Hex, blob: Uint8Array, locators: readonly Hex[]): Call {
  return { to: config.registry.address, value: 0n, data: encodeFunctionData({ abi: registryAbi, functionName: 'createVault', args: [vaultId, toHex(blob), locators] }) };
}

/**
 * Creates the vault (and deploys the account) in one user operation. The blob is cryptographically bound to its
 * vaultId, so `build(vaultId)` produces the blob for a given id. On VaultIdTaken (in preflight, or after inclusion
 * when front-run) it calls `onRetry`, rebuilds under a FRESH random vaultId, and retries exactly once.
 * LocatorFull surfaces as LOCATOR_FULL with the locator.
 */
export async function createVaultOnChain(
  p: { account: SmartAccount; build: (vaultId: Hex) => Promise<{ blob: Uint8Array; locators: readonly Hex[] }> },
  deps: WriteDeps & { onRetry?: () => void | Promise<void> },
): Promise<WriteResult> {
  const owner = await p.account.getAddress();
  const nextId = deps.randomId ?? randomVaultId;
  let lastErr: WriteError | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await deps.onRetry?.();
    const vaultId = nextId();
    const { blob, locators } = await p.build(vaultId);
    const calls = [createCall(vaultId, blob, locators)];
    try {
      await preflight(deps.client, owner, calls);
    } catch (e) {
      if (e instanceof WriteError && e.code === 'VAULT_ID_TAKEN') {
        lastErr = e;
        continue;
      }
      throw e;
    }
    await deps.onSign?.();
    const r = await deps.sponsor.send(p.account, calls);
    if (!r.success) {
      const err = revertOf(r.reason);
      if (err.code === 'VAULT_ID_TAKEN') {
        lastErr = err;
        continue;
      }
      throw err;
    }
    const v = await confirm(deps.reader, vaultId, owner, blob);
    return { vaultId, owner, version: v.version, blob, userOpHash: r.userOpHash, ...(r.txHash ? { txHash: r.txHash } : {}), locators: [...locators] };
  }
  throw lastErr ?? new WriteError('VAULT_ID_TAKEN');
}

export async function updateVaultOnChain(
  p: { account: SmartAccount; vaultId: Hex; blob: Uint8Array },
  deps: WriteDeps,
): Promise<Omit<WriteResult, 'locators'>> {
  const owner = await p.account.getAddress();
  const calls: Call[] = [
    { to: config.registry.address, value: 0n, data: encodeFunctionData({ abi: registryAbi, functionName: 'updateVault', args: [p.vaultId, toHex(p.blob)] }) },
  ];
  await preflight(deps.client, owner, calls);
  await deps.onSign?.();
  const r = await deps.sponsor.send(p.account, calls);
  if (!r.success) throw revertOf(r.reason);
  const v = await confirm(deps.reader, p.vaultId, owner, p.blob);
  return { vaultId: p.vaultId, owner, version: v.version, blob: p.blob, userOpHash: r.userOpHash, ...(r.txHash ? { txHash: r.txHash } : {}) };
}

/** Atomic add-key: addOwnerPublicKey (self) + addLocators + updateVault in one executeBatch. */
export async function addKeyOnChain(
  p: { account: SmartAccount; vaultId: Hex; blob: Uint8Array; newLocator: Hex; newPublicKey: Hex; keyCountBefore: number },
  deps: WriteDeps,
): Promise<Omit<WriteResult, 'locators'>> {
  const owner = await p.account.getAddress();
  // The new owner will land at nextOwnerIndex; the new blob entry at keyCountBefore. They must match, or
  // owner index == entry index (design D2) breaks and later signatures would use the wrong owner.
  const next = (await deps.client.readContract({ address: owner, abi: smartWalletAbi, functionName: 'nextOwnerIndex' })) as bigint;
  if (next !== BigInt(p.keyCountBefore)) throw new WriteError('OWNER_MISMATCH');
  const x = `0x${p.newPublicKey.slice(2, 66)}` as Hex;
  const y = `0x${p.newPublicKey.slice(66, 130)}` as Hex;
  const calls: Call[] = [
    { to: owner, value: 0n, data: encodeFunctionData({ abi: smartWalletAbi, functionName: 'addOwnerPublicKey', args: [x, y] }) },
    { to: config.registry.address, value: 0n, data: encodeFunctionData({ abi: registryAbi, functionName: 'addLocators', args: [p.vaultId, [p.newLocator]] }) },
    { to: config.registry.address, value: 0n, data: encodeFunctionData({ abi: registryAbi, functionName: 'updateVault', args: [p.vaultId, toHex(p.blob)] }) },
  ];
  await preflight(deps.client, owner, calls);
  await deps.onSign?.();
  const r = await deps.sponsor.send(p.account, calls);
  if (!r.success) throw revertOf(r.reason);
  const v = await confirm(deps.reader, p.vaultId, owner, p.blob);
  return { vaultId: p.vaultId, owner, version: v.version, blob: p.blob, userOpHash: r.userOpHash, ...(r.txHash ? { txHash: r.txHash } : {}) };
}

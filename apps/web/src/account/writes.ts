/**
 * Sponsored vault writes (spec sponsored-vault-writes; harden-gas-sponsorship: VaultRegistry v2 only). Every write:
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
  decodeFunctionResult,
  encodeFunctionData,
  http,
  parseAbi,
  type Hex,
  type PublicClient,
} from 'viem';
import {
  createBundlerClient,
  entryPoint06Address,
  type SmartAccount,
} from 'viem/account-abstraction';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { config } from '../config';
import { deriveVaultIdV2, registryV2Abi } from '../chain/contracts';
import { bytesEqual, randomBytes, toHex } from '../lib/bytes';
import type { RegistryReader } from '../chain/registry';
import { findKeyError } from '../webauthn';
import { ensureChain } from '../chain/guard';
import { notify, WriteError, type ProgressListener, type WriteErrorCode } from './errors';
import { assertSponsorableCallData, assertSponsorableCalls, PolicyError, smartWalletAbi, type Call } from './policy';

// The error type and the checklist events live in errors.ts (kept out of this lazily loaded module; see lazy.ts).
export { notify, WriteError, type ProgressListener, type SaveStage, type WriteErrorCode } from './errors';

const REGISTRY_ERROR_CODES: Record<string, WriteErrorCode> = {
  OwnerAlreadyHasVault: 'ALREADY_HAS_VAULT',
  TooManyLocators: 'TOO_MANY_KEYS',
  TooFewLocators: 'REVERTED',
  InvalidBlobSize: 'TOO_LARGE',
  NotVaultOwner: 'NOT_OWNER',
  DuplicateLocator: 'DUPLICATE_KEY',
  ZeroLocator: 'REVERTED',
  TooManyIds: 'REVERTED',
};

/** Maps VaultRegistry v2 revert data (custom error) to a WriteError. */
export function registryError(data: Hex | undefined): WriteError {
  if (data && data.length >= 10) {
    try {
      const e = decodeErrorResult({ abi: registryV2Abi, data });
      return new WriteError(REGISTRY_ERROR_CODES[e.errorName] ?? 'REVERTED');
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
    if (c.to.toLowerCase() !== config.registryV2.address.toLowerCase()) continue;
    try {
      await client.call({ account: from, to: c.to, data: c.data });
    } catch (e) {
      const data = revertData(e);
      if (data) throw registryError(data);
      throw new WriteError('NETWORK', { cause: e });
    }
  }
}

/** A listener that can be handed to code we don't control (e.g. a Sponsor implementation) without risk. */
const guarded = (listener: ProgressListener | undefined): ProgressListener | undefined => (listener ? (stage) => notify(listener, stage) : undefined);

export interface Sponsor {
  send(account: SmartAccount, calls: readonly Call[], onProgress?: ProgressListener): Promise<{ userOpHash: Hex; success: boolean; reason?: Hex; txHash?: Hex }>;
}

/** Bundler + ERC-7677 paymaster (Pimlico in production; the dev bundler in E2E). */
export function createSponsor(client: PublicClient, bundlerUrl = config.bundlerUrl, policyId = config.sponsorshipPolicyId): Sponsor {
  const pimlico = createPimlicoClient({
    transport: http(bundlerUrl, { timeout: 30_000 }),
    entryPoint: { address: entryPoint06Address, version: '0.6' },
  });
  const bundlerChain = { getChainId: async () => Number(await pimlico.request({ method: 'eth_chainId' } as never)) };
  return {
    async send(account, calls, onProgress) {
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
            throw new WriteError(isNonceConflict(e) ? 'NONCE_CONFLICT' : 'SPONSORSHIP_REFUSED', { cause: e });
          }
        },
        async getPaymasterData(p: Parameters<typeof pimlico.getPaymasterData>[0]) {
          guard(p as never);
          let data;
          try {
            data = await pimlico.getPaymasterData(p);
          } catch (e) {
            throw new WriteError(isNonceConflict(e) ? 'NONCE_CONFLICT' : 'SPONSORSHIP_REFUSED', { cause: e });
          }
          notify(onProgress, 'sponsored');
          return data;
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
      notify(onProgress, 'sent');
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

/** EntryPoint AA25: the account's key-0 nonce was already used (a concurrent save from another tab or device). */
export function isNonceConflict(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 10 && cur && typeof cur === 'object'; i++) {
    const c = cur as { message?: unknown; details?: unknown; shortMessage?: unknown; cause?: unknown };
    if ([c.message, c.details, c.shortMessage].some((m) => typeof m === 'string' && /AA25|invalid account nonce/i.test(m))) return true;
    cur = c.cause;
  }
  return false;
}

function classify(e: unknown): WriteError {
  if (e instanceof WriteError) return e;
  if (isNonceConflict(e)) return new WriteError('NONCE_CONFLICT', { cause: e });
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

/**
 * vault-list-labels-archive D8: every update starts from the current blob. Re-reads the vault and throws STALE when it
 * is gone or differs from `base` (the blob this session decrypted), so nothing is signed over a newer version.
 */
export async function assertCurrent(reader: Pick<RegistryReader, 'getVault'>, vaultId: Hex, base: Uint8Array): Promise<void> {
  let v;
  try {
    v = await reader.getVault(vaultId);
  } catch (e) {
    throw new WriteError('NETWORK', { cause: e });
  }
  if (!v || !bytesEqual(v.blob, base)) throw new WriteError('STALE');
}

/** EntryPoint v0.6 `getNonce`, beside the bundler's EntryPoint use above (D10: the testnet save-budget hint). */
const entryPointNonceAbi = parseAbi(['function getNonce(address sender, uint192 key) view returns (uint256 nonce)']);

/** Sponsored operations this account has used: its EntryPoint nonce for key 0 (one per included user operation). */
export async function sponsoredOpsUsed(client: Pick<PublicClient, 'readContract'>, owner: Hex): Promise<number> {
  const n = await client.readContract({ address: entryPoint06Address, abi: entryPointNonceAbi, functionName: 'getNonce', args: [owner, 0n] });
  return Number(n);
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
  /** Save-checklist notifications (never awaited; see notify). */
  onProgress?: ProgressListener;
  /** Test hook: the create salt (default: 32 random bytes). */
  randomSalt?: () => Hex;
}

const randomSalt = () => toHex(randomBytes(32));
const registryCall = (data: Hex): Call => ({ to: config.registryV2.address, value: 0n, data });

function createCall(salt: Hex, blob: Uint8Array, locators: readonly Hex[]): Call {
  return registryCall(encodeFunctionData({ abi: registryV2Abi, functionName: 'createVault', args: [salt, toHex(blob), locators] }));
}

/** The registry's own derivation (eth_call vaultIdFor) must equal ours before anything is encrypted under it. */
async function assertVaultId(client: PublicClient, owner: Hex, salt: Hex, vaultId: Hex): Promise<void> {
  let onChain: Hex;
  try {
    const r = await client.call({ to: config.registryV2.address, data: encodeFunctionData({ abi: registryV2Abi, functionName: 'vaultIdFor', args: [owner, salt] }) });
    onChain = decodeFunctionResult({ abi: registryV2Abi, functionName: 'vaultIdFor', data: r.data ?? '0x' });
  } catch (e) {
    throw new WriteError('NETWORK', { cause: e });
  }
  if (onChain.toLowerCase() !== vaultId.toLowerCase()) throw new WriteError('REVERTED', { cause: new Error('vaultId derivation mismatch') });
}

/**
 * Creates the vault (and deploys the account) in one user operation on VaultRegistry v2. The registry derives
 * vaultId = keccak256(abi.encode(account, salt)), so the client computes it from the counterfactual account address
 * and a fresh random salt, checks it against the registry's `vaultIdFor`, then encrypts under it (the blob is bound to
 * its vaultId). Nobody else can create under that id, so there is no "taken" retry (spec vault-registry
 * "Unique vault identifiers").
 */
export async function createVaultOnChain(
  p: { account: SmartAccount; build: (vaultId: Hex) => Promise<{ blob: Uint8Array; locators: readonly Hex[] }> },
  deps: WriteDeps,
): Promise<WriteResult> {
  const owner = await p.account.getAddress();
  const salt = (deps.randomSalt ?? randomSalt)();
  const vaultId = deriveVaultIdV2(owner, salt);
  await ensureChain(deps.client);
  await assertVaultId(deps.client, owner, salt, vaultId);
  const { blob, locators } = await p.build(vaultId);
  notify(deps.onProgress, 'encrypted');
  const calls = [createCall(salt, blob, locators)];
  await preflight(deps.client, owner, calls);
  await deps.onSign?.();
  const r = await deps.sponsor.send(p.account, calls, guarded(deps.onProgress));
  if (!r.success) throw revertOf(r.reason);
  const v = await confirm(deps.reader, vaultId, owner, blob);
  notify(deps.onProgress, 'confirmed');
  return { vaultId, owner, version: v.version, blob, userOpHash: r.userOpHash, ...(r.txHash ? { txHash: r.txHash } : {}), locators: [...locators] };
}

export async function updateVaultOnChain(
  p: { account: SmartAccount; vaultId: Hex; blob: Uint8Array; /** The blob this session decrypted (D8). */ base: Uint8Array },
  deps: WriteDeps,
): Promise<Omit<WriteResult, 'locators'>> {
  await assertCurrent(deps.reader, p.vaultId, p.base);
  const owner = await p.account.getAddress();
  const calls: Call[] = [registryCall(encodeFunctionData({ abi: registryV2Abi, functionName: 'updateVault', args: [p.vaultId, toHex(p.blob)] }))];
  await preflight(deps.client, owner, calls);
  await deps.onSign?.();
  const r = await deps.sponsor.send(p.account, calls, guarded(deps.onProgress));
  if (!r.success) throw revertOf(r.reason);
  const v = await confirm(deps.reader, p.vaultId, owner, p.blob);
  notify(deps.onProgress, 'confirmed');
  return { vaultId: p.vaultId, owner, version: v.version, blob: p.blob, userOpHash: r.userOpHash, ...(r.txHash ? { txHash: r.txHash } : {}) };
}

/** Atomic add-key: addOwnerPublicKey (self) + addLocators + updateVault in one executeBatch. */
export async function addKeyOnChain(
  p: { account: SmartAccount; vaultId: Hex; blob: Uint8Array; base: Uint8Array; newLocator: Hex; newPublicKey: Hex; keyCountBefore: number },
  deps: WriteDeps,
): Promise<Omit<WriteResult, 'locators'>> {
  await assertCurrent(deps.reader, p.vaultId, p.base);
  const owner = await p.account.getAddress();
  // The new owner will land at nextOwnerIndex; the new blob entry at keyCountBefore. They must match, or
  // owner index == entry index (design D2) breaks and later signatures would use the wrong owner.
  const next = (await deps.client.readContract({ address: owner, abi: smartWalletAbi, functionName: 'nextOwnerIndex' })) as bigint;
  if (next !== BigInt(p.keyCountBefore)) throw new WriteError('OWNER_MISMATCH');
  const x = `0x${p.newPublicKey.slice(2, 66)}` as Hex;
  const y = `0x${p.newPublicKey.slice(66, 130)}` as Hex;
  const calls: Call[] = [
    { to: owner, value: 0n, data: encodeFunctionData({ abi: smartWalletAbi, functionName: 'addOwnerPublicKey', args: [x, y] }) },
    registryCall(encodeFunctionData({ abi: registryV2Abi, functionName: 'addLocators', args: [p.vaultId, [p.newLocator]] })),
    registryCall(encodeFunctionData({ abi: registryV2Abi, functionName: 'updateVault', args: [p.vaultId, toHex(p.blob)] })),
  ];
  await preflight(deps.client, owner, calls);
  await deps.onSign?.();
  const r = await deps.sponsor.send(p.account, calls, guarded(deps.onProgress));
  if (!r.success) throw revertOf(r.reason);
  const v = await confirm(deps.reader, p.vaultId, owner, p.blob);
  notify(deps.onProgress, 'confirmed');
  return { vaultId: p.vaultId, owner, version: v.version, blob: p.blob, userOpHash: r.userOpHash, ...(r.txHash ? { txHash: r.txHash } : {}) };
}

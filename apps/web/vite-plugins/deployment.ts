/**
 * Reads the deployment record published by the contracts track (contracts/deployments/README.md; spec
 * deployment-targets "Per-chain deployment records", harden-gas-sponsorship):
 *
 *   {chainId, address?, deployBlock?, txHash?, abiHash?,           // VaultRegistry v1: legacy reads, optional
 *    contracts: {
 *      vaultRegistryV2: {address, deployBlock, txHash, abiHash},     // required: all writes, reads first
 *      wallets: {<rpId>: {implementation, factory, rpIdHash, deployBlock, txHash, abiHash, factoryAbiHash}}}}
 *
 * The wallet entry is selected by VITE_RP_ID. Anything missing or inconsistent fails the build: never a fallback to
 * another chain, another RP ID's wallet, or Coinbase's factory. Every abiHash is keccak256 of the exact bytes of the
 * exported ABI, and the app's own ABI fragments (src/chain/contracts.ts, src/account/policy.ts) must exist with the
 * same signature in those ABIs. Nothing about the contracts is hardcoded in the app.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAddress, isAddress, keccak256, sha256, toHex, type Abi, type AbiParameter } from 'viem';
import { registryV2Abi, smartWalletAbi, walletFactoryAbi } from '../src/chain/contracts.ts';

type Address = `0x${string}`;

export interface RegistryDeployment {
  address: Address;
  deployBlock: number;
  txHash: string;
  abiHash: string;
}

export interface WalletDeployment {
  rpId: string;
  factory: Address;
  implementation: Address;
  rpIdHash: `0x${string}`;
  deployBlock: number;
}

export interface Deployment {
  chainId: number;
  /** VaultRegistry v1, read-only; null where v1 was never deployed (OP Mainnet). */
  v1: (RegistryDeployment & { abi: unknown[] }) | null;
  v2: RegistryDeployment;
  wallet: WalletDeployment;
}

const COINBASE_FACTORY_V11 = '0xba5ed110efdba3d005bfc882d75358acbbb85842';
const OP_MAINNET = 10;

function readAbi(contractsDir: string, file: string): { bytes: Buffer; hash: string; abi: unknown[]; path: string } {
  const path = join(contractsDir, 'abi', file);
  if (!existsSync(path)) throw new Error(`ABI not found: ${path}`);
  const bytes = readFileSync(path);
  const abi = JSON.parse(bytes.toString('utf8')) as unknown;
  if (!Array.isArray(abi)) throw new Error(`${path} is not an ABI array`);
  return { bytes, hash: keccak256(toHex(new Uint8Array(bytes))), abi, path };
}

function checkHash(label: string, recordPath: string, recorded: unknown, abi: { hash: string; path: string }) {
  if (typeof recorded !== 'string' || recorded.toLowerCase() !== abi.hash.toLowerCase()) {
    throw new Error(`${label} ABI drift: ${recordPath} abiHash ${String(recorded)} != keccak256(${abi.path}) ${abi.hash}`);
  }
}

function address(recordPath: string, field: string, v: unknown): Address {
  if (typeof v !== 'string' || !isAddress(v, { strict: false })) throw new Error(`${recordPath}: invalid ${field} ${String(v)}`);
  return getAddress(v);
}

function block(recordPath: string, field: string, v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new Error(`${recordPath}: invalid ${field}`);
  return v;
}

const obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

/** Canonical signature of an ABI item: name, parameter types (tuples expanded), indexed flags, outputs, mutability. */
function param(p: AbiParameter & { indexed?: boolean }): string {
  const t = p.type.startsWith('tuple')
    ? `(${((p as { components?: AbiParameter[] }).components ?? []).map(param).join(',')})${p.type.slice(5)}`
    : p.type;
  return p.indexed ? `${t} indexed` : t;
}
function signature(item: Abi[number]): string {
  const i = item as { type: string; name?: string; inputs?: AbiParameter[]; outputs?: AbiParameter[]; stateMutability?: string };
  const ins = `${i.type} ${i.name ?? ''}(${(i.inputs ?? []).map(param).join(',')})`;
  if (i.type !== 'function') return ins;
  return `${ins} ${i.stateMutability ?? ''} returns (${(i.outputs ?? []).map(param).join(',')})`;
}

/** Every fragment the app uses must exist, with the identical signature, in the exported ABI. */
export function assertAbiCovers(used: Abi | readonly unknown[], exported: Abi | readonly unknown[], label: string): void {
  const have = new Set((exported as Abi).map(signature));
  const missing = (used as Abi).filter((i) => !have.has(signature(i))).map(signature);
  if (missing.length > 0) throw new Error(`${label}: the exported ABI does not match the app's interface: ${missing.join('; ')}`);
}

export function loadDeployment(contractsDir: string, chainId: number, rpId: string): Deployment {
  const recordPath = join(contractsDir, 'deployments', `${chainId}.json`);
  if (!existsSync(recordPath)) throw new Error(`No deployment record for chain ${chainId}: expected ${recordPath}`);
  const rec = JSON.parse(readFileSync(recordPath, 'utf8')) as Record<string, unknown>;
  if (rec.chainId !== chainId) throw new Error(`${recordPath}: chainId ${String(rec.chainId)} != configured ${chainId}`);

  // VaultRegistry v1 (top-level): legacy reads only, and never on OP Mainnet.
  let v1: Deployment['v1'] = null;
  if (rec.address !== undefined) {
    if (chainId === OP_MAINNET) throw new Error(`${recordPath}: VaultRegistry v1 is never deployed to OP Mainnet (chain 10); remove the top-level v1 entry`);
    const abi = readAbi(contractsDir, 'VaultRegistry.json');
    const addr = address(recordPath, 'address', rec.address);
    const deployBlock = block(recordPath, 'deployBlock', rec.deployBlock);
    checkHash('VaultRegistry', recordPath, rec.abiHash, abi);
    v1 = { address: addr, deployBlock, txHash: String(rec.txHash ?? ''), abiHash: abi.hash, abi: abi.abi };
  }

  const contracts = obj(rec.contracts);
  const r2 = obj(contracts?.vaultRegistryV2);
  if (!r2) throw new Error(`${recordPath}: missing contracts.vaultRegistryV2 (VaultRegistry v2 is required for writes)`);
  const abi2 = readAbi(contractsDir, 'VaultRegistryV2.json');
  checkHash('VaultRegistryV2', recordPath, r2.abiHash, abi2);
  assertAbiCovers(registryV2Abi, abi2.abi, 'VaultRegistryV2.json');
  const v2: RegistryDeployment = {
    address: address(recordPath, 'contracts.vaultRegistryV2.address', r2.address),
    deployBlock: block(recordPath, 'contracts.vaultRegistryV2.deployBlock', r2.deployBlock),
    txHash: String(r2.txHash ?? ''),
    abiHash: abi2.hash,
  };

  const w = obj(obj(contracts?.wallets)?.[rpId]);
  if (!w) {
    throw new Error(`${recordPath}: no wallet entry for RP ID "${rpId}" (contracts.wallets["${rpId}"]); deploy the CryoShield wallet pair for this RP ID`);
  }
  const at = `contracts.wallets["${rpId}"]`;
  const factory = address(recordPath, `${at}.factory`, w.factory);
  if (factory.toLowerCase() === COINBASE_FACTORY_V11) throw new Error(`${recordPath}: ${at}.factory is Coinbase's CBSW factory, not a CryoShield factory`);
  const implementation = address(recordPath, `${at}.implementation`, w.implementation);
  const expectedRpIdHash = sha256(toHex(new TextEncoder().encode(rpId)));
  if (typeof w.rpIdHash !== 'string' || w.rpIdHash.toLowerCase() !== expectedRpIdHash) {
    throw new Error(`${recordPath}: ${at}.rpIdHash ${String(w.rpIdHash)} != sha256("${rpId}") ${expectedRpIdHash}`);
  }
  const walletAbi = readAbi(contractsDir, 'CryoShieldSmartWallet.json');
  const factoryAbi = readAbi(contractsDir, 'CryoShieldSmartWalletFactory.json');
  checkHash('CryoShieldSmartWallet', recordPath, w.abiHash, walletAbi);
  checkHash('CryoShieldSmartWalletFactory', recordPath, w.factoryAbiHash, factoryAbi);
  assertAbiCovers(smartWalletAbi, walletAbi.abi, 'CryoShieldSmartWallet.json');
  assertAbiCovers(walletFactoryAbi, factoryAbi.abi, 'CryoShieldSmartWalletFactory.json');

  return {
    chainId,
    v1,
    v2,
    wallet: { rpId, factory, implementation, rpIdHash: expectedRpIdHash, deployBlock: block(recordPath, `${at}.deployBlock`, w.deployBlock) },
  };
}

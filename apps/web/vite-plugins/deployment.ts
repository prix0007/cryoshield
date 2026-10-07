/**
 * Reads the deployment record published by the contracts track (contracts/deployments/README.md; spec
 * deployment-targets "Per-chain deployment records", harden-gas-sponsorship; web-registry-versions D1):
 *
 *   {chainId, address?, deployBlock?, txHash?, abiHash?,           // VaultRegistry v1: legacy reads, optional
 *    contracts: {
 *      vaultRegistryV2: {address, deployBlock, txHash, abiHash},     // v2
 *      vaultRegistries?: {v3: {…}, …},                               // later versions (proposed key; also vaultRegistryV<N>)
 *      wallets: {<rpId>: {implementation, factory, rpIdHash, deployBlock, txHash, abiHash, factoryAbiHash}}}}
 *
 * Registries form one list, newest first (vite-plugins/registries.mjs, shared with deploy/release-manifest.mjs); the
 * newest takes every write. A version the app doesn't know fails the build. The wallet entry is selected by VITE_RP_ID.
 * Anything missing or inconsistent fails the build: never a fallback to another chain, another RP ID's wallet, or
 * Coinbase's factory. Every abiHash is keccak256 of the exact bytes of the exported ABI, and the app's own ABI fragments
 * (src/chain/contracts.ts, src/account/policy.ts) must exist with the same signature in those ABIs. Nothing about the
 * contracts is hardcoded in the app.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAddress, isAddress, keccak256, sha256, toHex, type Abi, type AbiParameter } from 'viem';
import { registryV1Abi, registryV2Abi, smartWalletAbi, walletFactoryAbi } from '../src/chain/contracts.ts';
import { registryList, type RegistryEntry } from './registries.mjs';

type Address = `0x${string}`;

export type RegistryDeployment = RegistryEntry;

export interface WalletDeployment {
  rpId: string;
  factory: Address;
  implementation: Address;
  rpIdHash: `0x${string}`;
  deployBlock: number;
}

export interface Deployment {
  chainId: number;
  /** Every VaultRegistry version, newest first; [0] takes every write, the rest are read-only. */
  registries: [RegistryDeployment, ...RegistryDeployment[]];
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

  const abis = { 1: readAbi(contractsDir, 'VaultRegistry.json'), 2: readAbi(contractsDir, 'VaultRegistryV2.json') };
  const list = registryList(rec, recordPath, { 1: abis[1].hash, 2: abis[2].hash });
  // VaultRegistry v1 (top-level): legacy reads only, and never on OP Mainnet.
  if (chainId === OP_MAINNET && list.some((r) => r.n === 1)) {
    throw new Error(`${recordPath}: VaultRegistry v1 is never deployed to OP Mainnet (chain 10); remove the top-level v1 entry`);
  }
  // The app's fragments must exist in each exported ABI it reads (or writes) through.
  if (list.some((r) => r.abi === 1)) assertAbiCovers(registryV1Abi, abis[1].abi, 'VaultRegistry.json');
  assertAbiCovers(registryV2Abi, abis[2].abi, 'VaultRegistryV2.json');
  const registries = list.map((r) => ({ ...r, address: address(recordPath, `${r.key}.address`, r.address) })) as Deployment['registries'];

  const contracts = obj(rec.contracts);
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
    registries,
    wallet: { rpId, factory, implementation, rpIdHash: expectedRpIdHash, deployBlock: block(recordPath, `${at}.deployBlock`, w.deployBlock) },
  };
}

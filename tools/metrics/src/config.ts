// Network presets and registry lists (OpenSpec change add-privacy-preserving-analytics, task 1.1).
// - names and chain IDs: config/chain-presets.json; public RPCs: tools/metrics/rpcs.json;
// - registries: EVERY VaultRegistry version in contracts/deployments/<chainId>.json (v1 = the top-level address,
//   contracts.vaultRegistryV<N>, and contracts.vaultRegistries.v<N>), the same shapes tools/recover accepts.
// Nothing here reads the environment, a .env file or a secret.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Hex } from 'viem';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TOOL_ROOT = fileURLToPath(new URL('../', import.meta.url));

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export interface RegistrySpec {
  version: number;
  address: Hex; // lowercase
  deployBlock: bigint;
  abi: 1 | 2;
}

export interface Network {
  name: string;
  chainId: number;
  rpcs: string[];
  registries: RegistrySpec[]; // newest first
  /** Small-cell suppression applies on every chain except the local development chain. */
  public: boolean;
}

export const LOCAL_CHAIN_ID = 31337;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const MAX_VERSION = 999;
const MAX_REGISTRIES = 8;
// keccak256 of contracts/abi/VaultRegistry.json and VaultRegistryV2.json (the records' abiHash).
const ABI_HASHES: Record<string, 1 | 2> = {
  '0x978e16a51813cacf2f723f72db77d1e10c186e489ccf4cca8ec8bb4517cd0a07': 1,
  '0xacb135ccf895846a59981b20545041660e21942c6108c000d9f1c46f552cb95c': 2,
};

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

export function parseAddress(v: unknown, what: string): Hex {
  if (typeof v !== 'string' || !ADDRESS.test(v)) throw new ConfigError(`${what} is not a 20-byte hex address`);
  if (/^0x0{40}$/.test(v)) throw new ConfigError(`${what} cannot be the zero address`);
  return v.toLowerCase() as Hex;
}

function abiFor(version: number, abiHash: unknown, where: string): 1 | 2 {
  const byHash = typeof abiHash === 'string' && HASH.test(abiHash) ? ABI_HASHES[abiHash.toLowerCase()] : undefined;
  if (version === 1 || version === 2) {
    if (byHash !== undefined && byHash !== version) throw new ConfigError(`${where}: registry v${version}'s abiHash is the v${byHash} ABI's`);
    return version;
  }
  if (byHash === undefined) throw new ConfigError(`${where}: registry v${version} has no known read ABI (abiHash); update tools/metrics`);
  return byHash;
}

function entry(version: number, e: unknown, where: string): RegistrySpec {
  if (!isObj(e)) throw new ConfigError(`${where}: registry v${version} must be an object with an address`);
  const block = e.deployBlock;
  if (block !== undefined && (typeof block !== 'number' || !Number.isSafeInteger(block) || block < 0)) {
    throw new ConfigError(`${where}: registry v${version} deployBlock must be a whole number >= 0`);
  }
  return {
    version,
    address: parseAddress(e.address, `${where}: registry v${version} address`),
    deployBlock: BigInt(block ?? 0),
    abi: abiFor(version, e.abiHash, where),
  };
}

/** A contracts/deployments/<chainId>.json record: its chain ID and every registry version, newest first. */
export function parseDeployment(doc: unknown, where = 'deployment record'): { chainId: number; registries: RegistrySpec[] } {
  if (!isObj(doc)) throw new ConfigError(`${where}: expected a JSON object`);
  const chainId = doc.chainId;
  if (typeof chainId !== 'number' || !Number.isSafeInteger(chainId) || chainId <= 0) throw new ConfigError(`${where}: chainId must be a positive whole number`);
  const found: [number, unknown][] = [];
  if ('address' in doc) found.push([1, { address: doc.address, deployBlock: doc.deployBlock, abiHash: doc.abiHash }]);
  const contracts = doc.contracts ?? {};
  if (!isObj(contracts)) throw new ConfigError(`${where}: contracts must be an object`);
  for (const [key, e] of Object.entries(contracts)) {
    const m = /^vaultRegistryV([1-9][0-9]{0,2})$/.exec(key);
    if (m) found.push([Number(m[1]), e]);
  }
  const listed = contracts.vaultRegistries;
  if (listed !== undefined) {
    if (!isObj(listed)) throw new ConfigError(`${where}: contracts.vaultRegistries must be an object keyed v3, v4, ...`);
    for (const [key, e] of Object.entries(listed)) {
      const m = /^v([1-9][0-9]{0,2})$/.exec(key);
      if (!m || Number(m[1]) > MAX_VERSION) throw new ConfigError(`${where}: registry version ${JSON.stringify(key.slice(0, 20))} must look like v3`);
      found.push([Number(m[1]), e]);
    }
  }
  const byVersion = new Map<number, RegistrySpec>();
  for (const [version, e] of found) {
    const spec = entry(version, e, where);
    const prev = byVersion.get(version);
    if (prev && (prev.address !== spec.address || prev.deployBlock !== spec.deployBlock)) throw new ConfigError(`${where}: registry v${version} is listed twice with different values`);
    byVersion.set(version, spec);
  }
  const registries = [...byVersion.values()].sort((a, b) => b.version - a.version);
  if (registries.length === 0) throw new ConfigError(`${where}: no VaultRegistry address in this record`);
  if (registries.length > MAX_REGISTRIES) throw new ConfigError(`${where}: more than ${MAX_REGISTRIES} registries`);
  const addrs = registries.map((r) => r.address);
  if (new Set(addrs).size !== addrs.length) throw new ConfigError(`${where}: one registry address is listed twice (as two versions)`);
  return { chainId, registries };
}

export interface Preset {
  name: string;
  chainId: number;
}

export function loadPresets(root = REPO_ROOT): Preset[] {
  const doc = readJson(join(root, 'config/chain-presets.json'));
  const list = isObj(doc) && Array.isArray(doc.presets) ? doc.presets : [];
  return list.filter(isObj).map((p) => ({ name: String(p.name), chainId: Number(p.chainId) }));
}

export const RPCS: Record<string, string[]> = Object.fromEntries(
  Object.entries(readJson(join(TOOL_ROOT, 'rpcs.json')) as Record<string, unknown>)
    .filter(([k, v]) => !k.startsWith('_') && Array.isArray(v))
    .map(([k, v]) => [k, (v as unknown[]).map(String)]),
);

function checkUrl(u: string): string {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    throw new ConfigError(`not a URL: ${JSON.stringify(u.slice(0, 80))}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new ConfigError(`only http(s) URLs are allowed: ${url.protocol}`);
  if (url.username || url.password) throw new ConfigError('URLs must not carry credentials');
  return u.replace(/\/+$/, '');
}

export function checkUrls(urls: string[]): string[] {
  return [...new Set(urls.map(checkUrl))];
}

export function loadNetwork(name: string, opts: { root?: string; rpcs?: string[]; deploymentFile?: string } = {}): Network {
  const root = opts.root ?? REPO_ROOT;
  const preset = loadPresets(root).find((p) => p.name === name);
  if (!preset) throw new ConfigError(`unknown network ${JSON.stringify(name)}; known: ${loadPresets(root).map((p) => p.name).join(', ')}`);
  const file = opts.deploymentFile ?? join(root, 'contracts/deployments', `${preset.chainId}.json`);
  let doc: unknown;
  try {
    doc = readJson(file);
  } catch (e) {
    if (opts.deploymentFile === undefined && (e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ConfigError(`${name}: no VaultRegistry deployment record (contracts/deployments/${preset.chainId}.json)`);
    }
    throw new ConfigError(`cannot read deployment record: ${(e as Error).message}`);
  }
  const record = parseDeployment(doc);
  if (record.chainId !== preset.chainId) throw new ConfigError(`the deployment record is for chain ${record.chainId}, not ${name} (${preset.chainId})`);
  const rpcs = checkUrls(opts.rpcs?.length ? opts.rpcs : (RPCS[name] ?? []));
  if (rpcs.length === 0) throw new ConfigError(`${name}: no RPC configured`);
  return { name, chainId: preset.chainId, rpcs, registries: record.registries, public: preset.chainId !== LOCAL_CHAIN_ID };
}

export interface GasConfig {
  entryPoint: Hex;
  paymasters: Hex[];
}

/** The sponsor paymasters for a network from tools/metrics/paymasters.json, or null when none is recorded. */
export function loadPaymasters(name: string): GasConfig | null {
  const doc = readJson(join(TOOL_ROOT, 'paymasters.json'));
  const net = isObj(doc) && isObj(doc.networks) ? doc.networks[name] : undefined;
  if (!isObj(net) || !isObj(net.entryPoint) || !Array.isArray(net.sponsors) || net.sponsors.length === 0) return null;
  return {
    entryPoint: parseAddress(net.entryPoint.address, `paymasters.json ${name} entryPoint`),
    paymasters: net.sponsors.map((s, i) => parseAddress(isObj(s) ? s.address : undefined, `paymasters.json ${name} sponsor ${i}`)),
  };
}

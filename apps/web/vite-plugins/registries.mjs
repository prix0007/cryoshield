/**
 * The ordered registry list of a deployment record (web-registry-versions D1). Plain ESM, so the Vite plugin
 * (deployment.ts) and deploy/release-manifest.mjs share one parser. Pure: the caller passes the keccak256 of the
 * exported ABIs (abi/VaultRegistry.json = kind 1, abi/VaultRegistryV2.json = kind 2).
 *
 * Sources (contracts/deployments/README.md; recover-registry-versions D5):
 *   top-level {address, deployBlock, txHash, abiHash}   -> v1
 *   contracts.vaultRegistryV<N>                          -> vN (v2 today)
 *   contracts.vaultRegistries.v<N>                       -> vN (proposed for v3 and later)
 * v1 and v2 have fixed ABI kinds 1 and 2. A later version gets the kind whose ABI hash its abiHash equals, byte for byte;
 * anything else fails ("update the app"), never a guess. Returned newest first; the newest must be kind 2 (writes).
 */

const KEY = /^v([1-9][0-9]{0,2})$/;
const RECORD_KEY = /^vaultRegistryV([1-9][0-9]{0,2})$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const FILES = { 1: 'abi/VaultRegistry.json', 2: 'abi/VaultRegistryV2.json' };
const LABELS = { 1: 'VaultRegistry', 2: 'VaultRegistryV2' };

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const lc = (s) => (typeof s === 'string' ? s.toLowerCase() : s);

function entry(where, key, n, e, abiHashes) {
  const version = `v${n}`;
  if (!isObj(e)) throw new Error(`${where}: registry ${version} must be an object (${key})`);
  if (typeof e.address !== 'string' || !ADDRESS.test(e.address)) throw new Error(`${where}: registry ${version} has an invalid address ${JSON.stringify(e.address)} (${key}.address)`);
  if (!Number.isSafeInteger(e.deployBlock) || e.deployBlock < 0) throw new Error(`${where}: registry ${version} has an invalid deployBlock (${key}.deployBlock)`);
  let abi = n <= 2 ? n : [1, 2].find((k) => lc(e.abiHash) === lc(abiHashes[k]));
  if (n <= 2 && lc(e.abiHash) !== lc(abiHashes[n])) {
    throw new Error(`${LABELS[n]} ABI drift: ${where} ${key}.abiHash ${String(e.abiHash)} != keccak256(${FILES[n]}) ${abiHashes[n]}`);
  }
  if (!abi) {
    throw new Error(
      `${where}: the app doesn't know VaultRegistry ${version} (${key}, abiHash ${String(e.abiHash)} matches neither ${FILES[1]} nor ${FILES[2]}); update the app`,
    );
  }
  return { version, n, abi, address: e.address, deployBlock: e.deployBlock, txHash: String(e.txHash ?? ''), abiHash: lc(abiHashes[abi]), key };
}

/**
 * @param {unknown} record parsed contracts/deployments/<chainId>.json
 * @param {string} where the record's path, for messages
 * @param {{1: string, 2: string}} abiHashes keccak256 of abi/VaultRegistry.json and abi/VaultRegistryV2.json
 */
export function registryList(record, where, abiHashes) {
  if (!isObj(record)) throw new Error(`${where}: not a deployment record (expected a JSON object)`);
  const contracts = record.contracts ?? {};
  if (!isObj(contracts)) throw new Error(`${where}: contracts must be an object`);
  const found = [];
  if (record.address !== undefined) found.push(entry(where, 'address', 1, record, abiHashes));
  for (const [k, e] of Object.entries(contracts)) {
    if (!k.startsWith('vaultRegistry') || k === 'vaultRegistries') continue;
    const m = RECORD_KEY.exec(k);
    // A near miss (vaultRegistryv3, vaultRegistry3, vaultRegistryV03) would silently skip a registry: refuse it.
    if (!m || k !== m[0]) throw new Error(`${where}: contracts has an invalid registry key ${JSON.stringify(k)} (expected vaultRegistryV2, vaultRegistryV3, …)`);
    found.push(entry(where, `contracts.${k}`, Number(m[1]), e, abiHashes));
  }
  if (contracts.vaultRegistries !== undefined) {
    if (!isObj(contracts.vaultRegistries)) throw new Error(`${where}: contracts.vaultRegistries must be an object keyed v3, v4, …`);
    for (const [k, e] of Object.entries(contracts.vaultRegistries)) {
      const m = KEY.exec(k);
      if (!m || k !== m[0]) throw new Error(`${where}: contracts.vaultRegistries has an invalid version key ${JSON.stringify(k)} (expected v3, v4, …)`);
      found.push(entry(where, `contracts.vaultRegistries.${k}`, Number(m[1]), e, abiHashes));
    }
  }
  const byVersion = new Map();
  for (const e of found) {
    const prev = byVersion.get(e.n);
    if (prev && (lc(prev.address) !== lc(e.address) || prev.deployBlock !== e.deployBlock || prev.abi !== e.abi)) {
      throw new Error(`${where}: registry ${e.version} is listed twice with different values (${prev.key}, ${e.key})`);
    }
    if (!prev) byVersion.set(e.n, e);
  }
  const list = [...byVersion.values()].sort((a, b) => b.n - a.n);
  const addresses = new Set();
  for (const e of list) {
    if (addresses.has(lc(e.address))) throw new Error(`${where}: two registry versions have the same address ${e.address}`);
    addresses.add(lc(e.address));
  }
  if (list.length === 0) throw new Error(`${where}: no VaultRegistry in the record (expected contracts.vaultRegistryV2)`);
  if (list[0].abi !== 2) {
    throw new Error(`${where}: the newest registry ${list[0].version} has no write interface; contracts.vaultRegistryV2 (or a later registry with its ABI) is required for writes`);
  }
  return list;
}

/**
 * Reads the VaultRegistry deployment record published by the contracts track:
 *   contracts/deployments/<chainId>.json = {chainId, address, deployBlock, txHash, abiHash}
 * abiHash = keccak256 of the exact bytes of contracts/abi/VaultRegistry.json.
 * Nothing about the registry is hardcoded in the app.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { keccak256, toHex, isAddress, getAddress } from 'viem';

export interface Deployment {
  chainId: number;
  address: `0x${string}`;
  deployBlock: number;
  txHash: string;
  abiHash: string;
  abi: unknown[];
}

export function loadDeployment(contractsDir: string, chainId: number): Deployment {
  const recordPath = join(contractsDir, 'deployments', `${chainId}.json`);
  const abiPath = join(contractsDir, 'abi', 'VaultRegistry.json');
  if (!existsSync(recordPath)) {
    throw new Error(`No VaultRegistry deployment for chain ${chainId}: expected ${recordPath}`);
  }
  if (!existsSync(abiPath)) throw new Error(`VaultRegistry ABI not found at ${abiPath}`);
  const abiBytes = readFileSync(abiPath);
  const actualHash = keccak256(toHex(new Uint8Array(abiBytes)));
  const rec = JSON.parse(readFileSync(recordPath, 'utf8')) as Record<string, unknown>;

  if (rec.chainId !== chainId) throw new Error(`${recordPath}: chainId ${String(rec.chainId)} != configured ${chainId}`);
  if (typeof rec.address !== 'string' || !isAddress(rec.address, { strict: false })) {
    throw new Error(`${recordPath}: invalid address ${String(rec.address)}`);
  }
  if (typeof rec.deployBlock !== 'number' || !Number.isSafeInteger(rec.deployBlock) || rec.deployBlock < 0) {
    throw new Error(`${recordPath}: invalid deployBlock`);
  }
  if (typeof rec.abiHash !== 'string' || rec.abiHash.toLowerCase() !== actualHash.toLowerCase()) {
    throw new Error(
      `VaultRegistry ABI drift: ${recordPath} abiHash ${String(rec.abiHash)} != keccak256(${abiPath}) ${actualHash}`,
    );
  }
  const abi = JSON.parse(abiBytes.toString('utf8')) as unknown;
  if (!Array.isArray(abi)) throw new Error(`${abiPath} is not an ABI array`);
  return {
    chainId,
    address: getAddress(rec.address),
    deployBlock: rec.deployBlock,
    txHash: String(rec.txHash ?? ''),
    abiHash: actualHash,
    abi,
  };
}

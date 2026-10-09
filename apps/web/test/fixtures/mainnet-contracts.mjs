#!/usr/bin/env node
/**
 * launch-op-mainnet 4.4 / 4.7: a TEST-ONLY contracts directory for chain-10 builds. It is never the real record and is
 * never written into contracts/: the real contracts/deployments/10.json comes only from the owner's deploy (task 7.2).
 *
 * The fixture copies contracts/abi and contracts/deployments, then adds a 10.json shaped like the planned record
 * (design D1, spec deployment-targets "Mainnet record contents"): chainId 10, contracts.vaultRegistryV2 and
 * contracts.wallets["cryoshield.app"] only, no top-level v1 entry. The addresses are the CREATE2 addresses recorded for
 * OP Sepolia (D1: identical on every chain); the deploy blocks and transaction hashes are fake.
 *
 *   node test/fixtures/mainnet-contracts.mjs <dir>     # then CRYOSHIELD_CONTRACTS_DIR=<dir> VERIFY_CHAIN_ID=10 …
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository's contracts/ (callers under a test runner pass it explicitly). */
const defaultContracts = () => fileURLToPath(new URL('../../../../contracts/', import.meta.url));
export const FIXTURE_DEPLOY_BLOCK = 140_000_000;
const FAKE_TX = (n) => `0x${String(n).repeat(64).slice(0, 64)}`;

/** The fixture 10.json, derived from 11155420.json. */
export function mainnetRecord(contracts = defaultContracts()) {
  const sepolia = JSON.parse(readFileSync(join(contracts, 'deployments', '11155420.json'), 'utf8'));
  const v2 = sepolia.contracts.vaultRegistryV2;
  const w = sepolia.contracts.wallets['cryoshield.app'];
  return {
    chainId: 10,
    contracts: {
      vaultRegistryV2: { abiHash: v2.abiHash, address: v2.address, deployBlock: FIXTURE_DEPLOY_BLOCK, txHash: FAKE_TX(1) },
      wallets: { 'cryoshield.app': { ...w, deployBlock: FIXTURE_DEPLOY_BLOCK + 1, txHash: FAKE_TX(2) } },
    },
  };
}

/** Writes the fixture contracts directory (abi/ + deployments/ incl. the fixture 10.json) into `dir`. */
export function makeMainnetContracts(dir, contracts = defaultContracts()) {
  mkdirSync(dir, { recursive: true });
  cpSync(join(contracts, 'abi'), join(dir, 'abi'), { recursive: true });
  cpSync(join(contracts, 'deployments'), join(dir, 'deployments'), { recursive: true });
  writeFileSync(join(dir, 'deployments', '10.json'), `${JSON.stringify(mainnetRecord(contracts), null, 2)}\n`);
  return dir;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node test/fixtures/mainnet-contracts.mjs <dir>');
    process.exit(2);
  }
  console.log(makeMainnetContracts(dir));
}

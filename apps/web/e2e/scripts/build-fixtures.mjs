#!/usr/bin/env node
/**
 * Regenerates e2e/fixtures/chain-fixtures.json: the canonical runtime bytecode of ERC-4337 EntryPoint v0.6
 * (+ its SenderCreator) and Coinbase Smart Wallet v1.1 (factory + implementation), read from OP Sepolia (the testnet),
 * plus the E2E paymaster compiled from e2e/contracts. The E2E stack places this code on a fresh anvil with
 * anvil_setCode, so tests run offline against the same contracts production uses.
 *
 *   node e2e/scripts/build-fixtures.mjs [--rpc https://sepolia.optimism.io]
 * The code is deterministic across chains; test/build/fixture-parity.test.ts checks it byte-for-byte against the
 * previous Arbitrum Sepolia copy (e2e/fixtures/chain-fixtures.arbitrum-sepolia.json).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, keccak256, parseAbi } from 'viem';

const here = dirname(fileURLToPath(import.meta.url));
const rpcIdx = process.argv.indexOf('--rpc');
const rpc = rpcIdx > 0 ? process.argv[rpcIdx + 1] : 'https://sepolia.optimism.io';
const client = createPublicClient({ transport: http(rpc) });
const sourceChainId = await client.getChainId();

const ENTRY_POINT_06 = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789';
const SENDER_CREATOR_06 = '0x7fc98430eAEdbb6070B35B39D798725049088348';
const CBSW_FACTORY_11 = '0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842';

const impl = await client.readContract({
  address: CBSW_FACTORY_11,
  abi: parseAbi(['function implementation() view returns (address)']),
  functionName: 'implementation',
});

const code = {};
for (const [name, address] of Object.entries({
  entryPoint06: ENTRY_POINT_06,
  senderCreator06: SENDER_CREATOR_06,
  cbswFactory11: CBSW_FACTORY_11,
  cbswImplementation11: impl,
})) {
  const bytecode = await client.getCode({ address });
  if (!bytecode || bytecode === '0x') throw new Error(`no code for ${name} at ${address} on ${rpc}`);
  code[name] = { address, codeHash: keccak256(bytecode), code: bytecode };
}

execFileSync('forge', ['build', '--root', join(here, '..', 'contracts')], { stdio: 'inherit' });
const pm = JSON.parse(readFileSync(join(here, '..', 'contracts', 'out', 'E2EPaymaster.sol', 'E2EPaymaster.json'), 'utf8'));

const out = { source: rpc, sourceChainId, generatedAt: new Date().toISOString(), ...code, e2ePaymaster: { bytecode: pm.bytecode.object } };
writeFileSync(join(here, '..', 'fixtures', 'chain-fixtures.json'), JSON.stringify(out, null, 2) + '\n');
console.log('wrote e2e/fixtures/chain-fixtures.json');

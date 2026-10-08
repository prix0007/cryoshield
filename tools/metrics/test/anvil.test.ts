// Task 1.3/1.6 on a real EVM: deploy VaultRegistry v1 and v2 to anvil, seed the known fixture (3 vaults with 2, 2 and
// 3 keys; one updated twice in 2026-W41), then run the documented CLI command and check the report. Skipped when
// Foundry is missing, unless CRYOSHIELD_REQUIRE_FOUNDRY=1 (CI).
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeFunctionData, keccak256, parseAbi, toHex, type Hex } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../src/config.ts';
import { findIdentifiers } from '../src/report.ts';
import { fixtureBlob } from './fixtures/blobs.ts';

const has = (bin: string) => spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0;
const HAVE_FOUNDRY = has('anvil') && has('forge');
if (process.env.CRYOSHIELD_REQUIRE_FOUNDRY === '1' && !HAVE_FOUNDRY) throw new Error('CRYOSHIELD_REQUIRE_FOUNDRY is set but anvil/forge are not on PATH');

// anvil's default unlocked dev accounts (public, well-known)
const ACCOUNTS: Hex[] = [
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
];
const V1 = parseAbi([
  'function createVault(bytes32 vaultId, bytes blob, bytes32[] locators)',
  'function updateVault(bytes32 vaultId, bytes blob)',
]);
const V2 = parseAbi([
  'function createVault(bytes32 salt, bytes blob, bytes32[] locators) returns (bytes32)',
  'function updateVault(bytes32 vaultId, bytes blob)',
  'function vaultIdFor(address owner, bytes32 salt) view returns (bytes32)',
]);
const MON_W41 = Date.UTC(2026, 9, 5, 12) / 1000;
const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

const freePort = () =>
  new Promise<number>((res) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => res(port));
    });
  });

describe.skipIf(!HAVE_FOUNDRY)('anvil fixture', () => {
  let anvil: ChildProcess;
  let url = '';
  let deployment = '';
  let id = 0;
  const rpc = async (method: string, params: unknown[] = []): Promise<unknown> => {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    const j = (await r.json()) as { result?: unknown; error?: { message: string } };
    if (j.error) throw new Error(`${method}: ${j.error.message}`);
    return j.result;
  };
  type Receipt = { status: string; contractAddress: Hex | null; blockNumber: Hex };
  const waitReceipt = async (hash: Hex): Promise<Receipt> => {
    for (let i = 0; i < 100; i++) {
      const r = (await rpc('eth_getTransactionReceipt', [hash])) as Receipt | null;
      if (r) return r;
      await new Promise((res) => setTimeout(res, 50));
    }
    throw new Error('no receipt');
  };
  const send = async (from: Hex, data: Hex, to?: Hex, ts?: number) => {
    if (ts !== undefined) await rpc('evm_setNextBlockTimestamp', [ts]);
    const hash = (await rpc('eth_sendTransaction', [{ from, data, ...(to ? { to } : {}), gas: '0x989680' }])) as Hex;
    const receipt = await waitReceipt(hash);
    if (receipt.status !== '0x1') throw new Error('transaction reverted');
    return receipt;
  };
  const bytecode = (contract: string, profile?: string): Hex => {
    const r = spawnSync('forge', ['inspect', contract, 'bytecode'], {
      cwd: join(REPO_ROOT, 'contracts'),
      encoding: 'utf8',
      env: { ...process.env, ...(profile ? { FOUNDRY_PROFILE: profile } : {}) },
    });
    if (r.status !== 0) throw new Error(`forge inspect ${contract}: ${r.stderr}`);
    return r.stdout.trim().split('\n').pop() as Hex;
  };

  beforeAll(async () => {
    const port = await freePort();
    url = `http://127.0.0.1:${port}`;
    anvil = spawn('anvil', ['--port', String(port), '--silent', '--timestamp', String(MON_W41 - 3600)], { stdio: 'ignore' });
    for (let i = 0; ; i++) {
      try {
        await rpc('eth_chainId');
        break;
      } catch {
        if (i > 100) throw new Error('anvil did not start');
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    const reg1 = (await send(ACCOUNTS[0] as Hex, bytecode('VaultRegistry'))).contractAddress as Hex;
    const d2 = await send(ACCOUNTS[0] as Hex, bytecode('VaultRegistryV2'));
    const reg2 = d2.contractAddress as Hex;
    const loc = (s: string) => keccak256(toHex(`loc-${s}`));
    const t = (h: number) => MON_W41 + h * 3600;

    // vault A: registry v1, 2 keys; vaults B (2 keys) and C (3 keys): registry v2; C updated twice in W41
    await send(ACCOUNTS[1] as Hex, encodeFunctionData({ abi: V1, functionName: 'createVault', args: [keccak256(toHex('a')), toHex(fixtureBlob(2, { seed: 1 })), [loc('a1'), loc('a2')]] }), reg1, t(1));
    await send(ACCOUNTS[2] as Hex, encodeFunctionData({ abi: V2, functionName: 'createVault', args: [keccak256(toHex('b')), toHex(fixtureBlob(2, { seed: 2 })), [loc('b1'), loc('b2')]] }), reg2, t(2));
    await send(ACCOUNTS[3] as Hex, encodeFunctionData({ abi: V2, functionName: 'createVault', args: [keccak256(toHex('c')), toHex(fixtureBlob(3, { seed: 3 })), [loc('c1'), loc('c2')]] }), reg2, t(3));
    const vc = (await rpc('eth_call', [{ to: reg2, data: encodeFunctionData({ abi: V2, functionName: 'vaultIdFor', args: [ACCOUNTS[3] as Hex, keccak256(toHex('c'))] }) }, 'latest'])) as Hex;
    await send(ACCOUNTS[3] as Hex, encodeFunctionData({ abi: V2, functionName: 'updateVault', args: [vc, toHex(fixtureBlob(3, { seed: 4 }))] }), reg2, t(4));
    await send(ACCOUNTS[3] as Hex, encodeFunctionData({ abi: V2, functionName: 'updateVault', args: [vc, toHex(fixtureBlob(3, { seed: 5 }))] }), reg2, t(5));

    deployment = join(mkdtempSync(join(tmpdir(), 'metrics-anvil-')), '31337.json');
    writeFileSync(
      deployment,
      JSON.stringify({ chainId: 31337, address: reg1, deployBlock: 0, contracts: { vaultRegistryV2: { address: reg2, deployBlock: Number(BigInt(d2.blockNumber)) } } }),
    );
  }, 120_000);

  afterAll(() => {
    anvil?.kill();
  });

  it('the documented command reproduces the fixture report', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'metrics-out-')), 'metrics.json');
    // README: pnpm metrics --network anvil --rpc http://127.0.0.1:8545 --deployment <file> --no-mirror --out metrics.json
    const r = spawnSync(process.execPath, [CLI, '--network', 'anvil', '--rpc', url, '--deployment', deployment, '--no-mirror', '--out', out], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '' }, // no secrets, no .env: an empty environment is enough
    });
    expect(r.stderr).toMatch(/report written/);
    expect(r.status).toBe(0);
    const report = JSON.parse(readFileSync(out, 'utf8'));
    expect(report.vaults_total).toBe(3);
    expect(report.vaults_by_registry).toEqual({ v1: 1, v2: 2 });
    expect(report.keys_per_vault).toEqual({ '2': 2, '3': 1 });
    expect(report.created).toEqual({ '2026-W41': 3 });
    expect(report.updates).toEqual({ '2026-W41': 2 });
    expect(report.weekly_active).toEqual({ '2026-W41': 3 });
    expect(report.registries.map((x: { version: string }) => x.version)).toEqual(['v2', 'v1']);
    expect(findIdentifiers(JSON.stringify(report), report.registries.map((x: { address: string }) => x.address))).toEqual([]);
  });

  it('exits non-zero before reading logs when the RPC is another chain', async () => {
    const d = join(mkdtempSync(join(tmpdir(), 'metrics-')), 'd.json');
    writeFileSync(d, JSON.stringify({ chainId: 11155420, address: ACCOUNTS[0] }));
    const r = spawnSync(process.execPath, [CLI, '--network', 'op-sepolia', '--rpc', url, '--deployment', d, '--no-mirror', '--no-gas'], { encoding: 'utf8' });
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/chain ID 31337, expected 11155420/);
  });
});

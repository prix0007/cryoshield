/**
 * Local E2E chain stack (design D11, "E2E bundler choice"):
 *   anvil (chain 31337)
 *   + canonical EntryPoint v0.6 / SenderCreator / Coinbase Smart Wallet v1.1 runtime code (anvil_setCode, from
 *     e2e/fixtures/chain-fixtures.json, read from OP Sepolia; byte-identical on Arbitrum)
 *   + VaultRegistry deployed exactly as contracts/script/deploy.sh does (CREATE2, same salt -> same address as
 *     contracts/deployments/31337.json)
 *   + E2EPaymaster (accept-all, deposited in the EntryPoint)
 *   + a minimal dev bundler (ERC-4337 + ERC-7677 + pimlico_getUserOperationGasPrice JSON-RPC) on :4337.
 *
 * The dev bundler submits each user operation with EntryPoint.handleOps from an anvil account, so signatures,
 * account deployment, WebAuthn P-256 verification and the registry calls all run on-chain for real.
 * It does NOT run ERC-7562 simulation; production uses Pimlico.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  concat,
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeErrorResult,
  decodeEventLog,
  decodeFunctionData,
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  http,
  keccak256,
  parseAbi,
  parseEther,
  toFunctionSelector,
  toHex,
  type Hex,
} from 'viem';
import { entryPoint06Abi } from 'viem/account-abstraction';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..', '..');
const fixtures = JSON.parse(readFileSync(join(here, '..', 'fixtures', 'chain-fixtures.json'), 'utf8'));
const deployment = JSON.parse(readFileSync(join(repo, 'contracts', 'deployments', '31337.json'), 'utf8'));

export const ANVIL_PORT = 8545;
export const BUNDLER_PORT = 4337;
export const POLICY_ID = 'sp_e2e_local';
const RPC = `http://127.0.0.1:${ANVIL_PORT}`;
const chain = {
  id: 31337,
  name: 'anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
} as const;

const DEPLOYER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const; // anvil #0 (unlocked)
const BUNDLER_EOA = '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720' as const; // anvil #9 (unlocked)
const CREATE2_DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C' as const;
const CREATE2_DEPLOYER_CODE =
  '0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3';

const transport = http(RPC);
export const pub = createPublicClient({ chain, transport });
const wallet = createWalletClient({ chain, transport });
const test = createTestClient({ chain, transport, mode: 'anvil' });

const ENTRY_POINT = getAddress(fixtures.entryPoint06.address) as Hex;

async function waitForRpc(url: string, tries = 100) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' });
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${url} did not start`);
}

async function send(tx: { from: Hex; to?: Hex; data?: Hex; value?: bigint; gas?: bigint }) {
  const hash = await wallet.sendTransaction({ account: tx.from, chain, to: tx.to ?? null, data: tx.data, value: tx.value, gas: tx.gas } as never);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`tx ${hash} reverted`);
  return receipt;
}

export async function setupContracts(): Promise<{ registry: Hex; paymaster: Hex }> {
  for (const k of ['entryPoint06', 'senderCreator06', 'cbswFactory11', 'cbswImplementation11']) {
    const f = fixtures[k];
    if (keccak256(f.code) !== f.codeHash) throw new Error(`fixture ${k} hash mismatch`);
    await test.setCode({ address: f.address, bytecode: f.code });
  }
  if ((await pub.getCode({ address: CREATE2_DEPLOYER })) === undefined) {
    await test.setCode({ address: CREATE2_DEPLOYER, bytecode: CREATE2_DEPLOYER_CODE });
  }

  // VaultRegistry: identical CREATE2 deploy to contracts/script/deploy.sh (read-only use of contracts/out).
  const artifact = JSON.parse(readFileSync(join(repo, 'contracts', 'out', 'VaultRegistry.sol', 'VaultRegistry.json'), 'utf8'));
  const salt = keccak256(toHex('cryoshield.vault-registry.v1'));
  const initCode = artifact.bytecode.object as Hex;
  const registry = getContractAddress({ from: CREATE2_DEPLOYER, salt, bytecode: initCode, opcode: 'CREATE2' });
  if (registry.toLowerCase() !== String(deployment.address).toLowerCase()) {
    throw new Error(`registry CREATE2 address ${registry} != contracts/deployments/31337.json ${deployment.address}; rebuild contracts (forge build)`);
  }
  if (!(await pub.getCode({ address: registry }))) {
    await send({ from: DEPLOYER, to: CREATE2_DEPLOYER, data: concat([salt, initCode]), gas: 5_000_000n });
  }

  const pmReceipt = await send({
    from: DEPLOYER,
    data: encodeDeployData({
      abi: parseAbi(['constructor(address entryPoint)']),
      bytecode: fixtures.e2ePaymaster.bytecode,
      args: [ENTRY_POINT],
    }),
    gas: 2_000_000n,
  });
  const paymaster = pmReceipt.contractAddress as Hex;
  await send({
    from: DEPLOYER,
    to: ENTRY_POINT,
    data: encodeFunctionData({ abi: entryPoint06Abi, functionName: 'depositTo', args: [paymaster] }),
    value: parseEther('100'),
  });
  return { registry, paymaster };
}

// --- dev bundler -------------------------------------------------------------------------------------------

const walletAbi = parseAbi([
  'function execute(address target, uint256 value, bytes data)',
  'function executeBatch((address target, uint256 value, bytes data)[] calls)',
]);
const ALLOWED_REGISTRY = new Set(
  ['createVault(bytes32,bytes,bytes32[])', 'updateVault(bytes32,bytes)', 'addLocators(bytes32,bytes32[])'].map(toFunctionSelector),
);
const ALLOWED_SELF = new Set([toFunctionSelector('addOwnerPublicKey(bytes32,bytes32)')]);

export interface PolicyState {
  refuseAll: boolean;
  perSenderLimit: number;
  counts: Map<string, number>;
  sponsored: number;
}

type RpcUserOp = Record<string, Hex>;

function toOp(o: RpcUserOp) {
  return {
    sender: o.sender!,
    nonce: BigInt(o.nonce!),
    initCode: o.initCode ?? '0x',
    callData: o.callData!,
    callGasLimit: BigInt(o.callGasLimit ?? '0x0'),
    verificationGasLimit: BigInt(o.verificationGasLimit ?? '0x0'),
    preVerificationGas: BigInt(o.preVerificationGas ?? '0x0'),
    maxFeePerGas: BigInt(o.maxFeePerGas ?? '0x0'),
    maxPriorityFeePerGas: BigInt(o.maxPriorityFeePerGas ?? '0x0'),
    paymasterAndData: o.paymasterAndData ?? '0x',
    signature: o.signature ?? '0x',
  } as const;
}

class RpcError extends Error {
  code: number;
  data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

/** Emulates the server-side sponsorship policy (Pimlico enforces this off-chain in production). */
function checkPolicy(policy: PolicyState, op: RpcUserOp, registry: Hex, context: { sponsorshipPolicyId?: string } | undefined) {
  if (context?.sponsorshipPolicyId !== POLICY_ID) throw new RpcError(-32602, 'unknown sponsorship policy');
  if (policy.refuseAll) throw new RpcError(-32603, 'sponsorship policy global limit reached');
  const sender = op.sender!.toLowerCase();
  if ((policy.counts.get(sender) ?? 0) >= policy.perSenderLimit) throw new RpcError(-32603, 'sponsorship policy per-user limit reached');
  const d = decodeFunctionData({ abi: walletAbi, data: op.callData! });
  const calls =
    d.functionName === 'execute'
      ? [{ target: d.args[0], value: d.args[1], data: d.args[2] }]
      : (d.args[0] as readonly { target: Hex; value: bigint; data: Hex }[]);
  for (const c of calls) {
    const sel = c.data.slice(0, 10) as Hex;
    const ok =
      c.value === 0n &&
      ((c.target.toLowerCase() === registry.toLowerCase() && ALLOWED_REGISTRY.has(sel)) ||
        (c.target.toLowerCase() === sender && ALLOWED_SELF.has(sel)));
    if (!ok) throw new RpcError(-32603, 'sponsorship policy rejected call target');
  }
}

export function startBundler(registry: Hex, paymaster: Hex, port = BUNDLER_PORT) {
  const policy: PolicyState = { refuseAll: false, perSenderLimit: 20, counts: new Map(), sponsored: 0 };
  const receipts = new Map<string, unknown>();

  async function handle(method: string, params: unknown[]): Promise<unknown> {
    switch (method) {
      case 'eth_chainId':
        return toHex(chain.id);
      case 'eth_supportedEntryPoints':
        return [ENTRY_POINT];
      case 'pimlico_getUserOperationGasPrice': {
        const block = await pub.getBlock();
        const max = (block.baseFeePerGas ?? 1_000_000_000n) * 2n + 1_000_000_000n;
        const tier = { maxFeePerGas: toHex(max), maxPriorityFeePerGas: toHex(1_000_000_000n) };
        return { slow: tier, standard: tier, fast: tier };
      }
      case 'pm_getPaymasterStubData':
      case 'pm_getPaymasterData': {
        const [op, ep, , context] = params as [RpcUserOp, Hex, Hex, { sponsorshipPolicyId?: string }];
        if (ep.toLowerCase() !== ENTRY_POINT.toLowerCase()) throw new RpcError(-32602, 'unsupported entry point');
        checkPolicy(policy, op, registry, context);
        return { paymasterAndData: paymaster };
      }
      case 'eth_estimateUserOperationGas':
        return { preVerificationGas: toHex(80_000n), verificationGasLimit: toHex(2_500_000n), callGasLimit: toHex(2_000_000n) };
      case 'eth_sendUserOperation': {
        const [rpcOp, ep] = params as [RpcUserOp, Hex];
        if (ep.toLowerCase() !== ENTRY_POINT.toLowerCase()) throw new RpcError(-32602, 'unsupported entry point');
        if (rpcOp.paymasterAndData?.toLowerCase().startsWith(paymaster.toLowerCase())) {
          checkPolicy(policy, rpcOp, registry, { sponsorshipPolicyId: POLICY_ID });
        }
        const op = toOp(rpcOp);
        const data = encodeFunctionData({ abi: entryPoint06Abi, functionName: 'handleOps', args: [[op], BUNDLER_EOA] });
        try {
          await pub.call({ account: BUNDLER_EOA, to: ENTRY_POINT, data, gas: 15_000_000n });
        } catch (e) {
          const raw = (e as { data?: Hex; cause?: { data?: Hex } }).data ?? (e as { cause?: { data?: Hex } }).cause?.data;
          let reason = 'handleOps reverted';
          if (raw) {
            try {
              const err = decodeErrorResult({ abi: entryPoint06Abi, data: raw });
              reason = `${err.errorName}: ${JSON.stringify(err.args, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}`;
            } catch {
              /* keep generic */
            }
          }
          throw new RpcError(-32500, reason);
        }
        const userOpHash = (await pub.readContract({ address: ENTRY_POINT, abi: entryPoint06Abi, functionName: 'getUserOpHash', args: [op] })) as Hex;
        const receipt = await send({ from: BUNDLER_EOA, to: ENTRY_POINT, data, gas: 15_000_000n });
        let success = false;
        let reason: Hex | undefined;
        let actualGasCost = 0n;
        let actualGasUsed = 0n;
        const logs = [];
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== ENTRY_POINT.toLowerCase()) {
            logs.push(log);
            continue;
          }
          try {
            const ev = decodeEventLog({ abi: entryPoint06Abi, data: log.data, topics: log.topics });
            if (ev.eventName === 'UserOperationEvent') {
              success = ev.args.success;
              actualGasCost = ev.args.actualGasCost;
              actualGasUsed = ev.args.actualGasUsed;
            }
            if (ev.eventName === 'UserOperationRevertReason') reason = ev.args.revertReason;
          } catch {
            /* other EP events */
          }
        }
        policy.counts.set(op.sender.toLowerCase(), (policy.counts.get(op.sender.toLowerCase()) ?? 0) + 1);
        policy.sponsored++;
        const rawReceipt = await pub.request({ method: 'eth_getTransactionReceipt', params: [receipt.transactionHash] });
        receipts.set(userOpHash.toLowerCase(), {
          userOpHash,
          entryPoint: ENTRY_POINT,
          sender: op.sender,
          nonce: toHex(op.nonce),
          paymaster,
          actualGasCost: toHex(actualGasCost),
          actualGasUsed: toHex(actualGasUsed),
          success,
          reason: reason ?? '0x',
          logs: (rawReceipt as { logs: unknown[] }).logs,
          receipt: rawReceipt,
        });
        return userOpHash;
      }
      case 'eth_getUserOperationReceipt':
        return receipts.get(String(params[0]).toLowerCase()) ?? null;
      case 'eth_getUserOperationByHash':
        return null;
      // Test controls (not part of any public API).
      case 'cryoshield_setPolicy': {
        const p = params[0] as Partial<{ refuseAll: boolean; perSenderLimit: number }>;
        if (p.refuseAll !== undefined) policy.refuseAll = p.refuseAll;
        if (p.perSenderLimit !== undefined) policy.perSenderLimit = p.perSenderLimit;
        return true;
      }
      case 'cryoshield_stats':
        return { sponsored: policy.sponsored, registry, paymaster };
      default:
        throw new RpcError(-32601, `method ${method} not supported by the dev bundler`);
    }
  }

  const server: Server = createServer((req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      const one = async (msg: { id: unknown; method: string; params?: unknown[] }) => {
        try {
          return { jsonrpc: '2.0', id: msg.id, result: await handle(msg.method, msg.params ?? []) };
        } catch (e) {
          const err = e instanceof RpcError ? e : new RpcError(-32603, (e as Error).message);
          return { jsonrpc: '2.0', id: msg.id, error: { code: err.code, message: err.message, data: err.data } };
        }
      };
      let out;
      try {
        const parsed = JSON.parse(body);
        out = Array.isArray(parsed) ? await Promise.all(parsed.map(one)) : await one(parsed);
      } catch {
        out = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } };
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
    });
  });
  server.listen(port, '127.0.0.1');
  return { server, policy };
}

export interface Stack {
  anvil: ChildProcess;
  server: Server;
  registry: Hex;
  paymaster: Hex;
  stop(): Promise<void>;
}

export async function startStack(): Promise<Stack> {
  const anvil = spawn('anvil', ['--port', String(ANVIL_PORT), '--chain-id', '31337', '--silent', '--code-size-limit', '50000'], {
    stdio: 'ignore',
  });
  await waitForRpc(RPC);
  const { registry, paymaster } = await setupContracts();
  const { server } = startBundler(registry, paymaster);
  await waitForRpc(`http://127.0.0.1:${BUNDLER_PORT}`);
  return {
    anvil,
    server,
    registry,
    paymaster,
    async stop() {
      server.close();
      anvil.kill();
    },
  };
}

// Standalone: `node e2e/stack/stack.ts` keeps the stack running for manual testing with `pnpm dev`.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const s = await startStack();
  console.log(`anvil ${RPC}, dev bundler http://127.0.0.1:${BUNDLER_PORT}, registry ${s.registry}, paymaster ${s.paymaster}`);
  process.on('SIGINT', () => void s.stop().then(() => process.exit(0)));
}

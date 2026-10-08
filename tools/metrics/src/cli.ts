#!/usr/bin/env node
// cryoshield metrics CLI (OpenSpec change add-privacy-preserving-analytics, design D1).
//   pnpm metrics --network op-sepolia [--out metrics.json]
// Reads public RPCs and Arweave gateways only; needs no secret, key, wallet or .env. Exit codes: 0 report written,
// 1 failure, 2 usage error, 3 an RPC reports another chain (nothing was read).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { checkUrls, ConfigError, loadNetwork, loadPaymasters } from './config.ts';
import { clean } from './http.ts';
import { collect } from './metrics.ts';
import { DEFAULT_GATEWAYS } from './mirror.ts';
import { ChainIdMismatchError } from './rpc.ts';

const USAGE = `Usage: pnpm metrics [options]

Aggregate, identifier-free CryoShield metrics from public chain and Arweave data.

  --network NAME       preset from config/chain-presets.json (default: op-sepolia)
  --rpc URL            public RPC to use instead of the preset's (repeatable)
  --deployment FILE    deployment record to use instead of contracts/deployments/<chainId>.json
  --to-block N         last block to read (default: the chain head)
  --arweave URL        Arweave gateway for mirror coverage (repeatable; default: ${DEFAULT_GATEWAYS.join(', ')})
  --no-mirror          skip mirror coverage
  --no-gas             skip sponsored gas
  --out FILE           write the JSON report here (default: stdout)
  -q, --quiet          no progress on stderr
  -h, --help           this help
`;

export async function main(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: {
        network: { type: 'string', default: 'op-sepolia' },
        rpc: { type: 'string', multiple: true },
        deployment: { type: 'string' },
        'to-block': { type: 'string' },
        arweave: { type: 'string', multiple: true },
        'no-mirror': { type: 'boolean', default: false },
        'no-gas': { type: 'boolean', default: false },
        out: { type: 'string' },
        quiet: { type: 'boolean', short: 'q', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const log = args.quiet ? () => {} : (m: string) => process.stderr.write(`metrics: ${clean(m, 400)}\n`);
  try {
    if (args['to-block'] !== undefined && !/^[0-9]{1,19}$/.test(args['to-block'])) throw new ConfigError('--to-block must be a block number');
    const net = loadNetwork(args.network, {
      ...(args.rpc ? { rpcs: args.rpc } : {}),
      ...(args.deployment ? { deploymentFile: resolve(args.deployment) } : {}),
    });
    const gas = args['no-gas'] ? false : (loadPaymasters(net.name) ?? false);
    const report = await collect(net, {
      mirror: args['no-mirror'] ? false : { gateways: checkUrls(args.arweave ?? DEFAULT_GATEWAYS) },
      gas,
      ...(args['to-block'] !== undefined ? { toBlock: BigInt(args['to-block']) } : {}),
      log,
    });
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (args.out) {
      mkdirSync(dirname(resolve(args.out)), { recursive: true });
      writeFileSync(resolve(args.out), json);
      log(`report written to ${args.out}`);
    } else process.stdout.write(json);
    return 0;
  } catch (e) {
    process.stderr.write(`metrics: ${clean((e as Error).message, 400)}\n`);
    if (e instanceof ChainIdMismatchError) return 3;
    return e instanceof ConfigError ? 2 : 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}

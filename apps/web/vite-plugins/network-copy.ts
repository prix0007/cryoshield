/**
 * launch-op-mainnet D6: the public copy follows the build's chain. One build-time mechanism for every static page,
 * the shared header/footer partials and the legal Markdown:
 *
 *   <!--net:testnet-->…<!--/net-->   kept on a test network (and on any chain without a known status: fail safe)
 *   <!--net:mainnet-->…<!--/net-->   kept on a main network (OP Mainnet)
 *   <!--net:moving-->…<!--/net-->    kept on the production testnet build during the "moving to OP Mainnet" window
 *   __CS_NET_NAME__                  the network's short name ("OP Sepolia", "OP Mainnet")
 *   __CS_RPC_HOST__, __CS_RPC_VENDOR__  the configured RPC host and its vendor in docs/compliance/origins.json
 *
 * Blocks don't nest. An unknown block, an unclosed block or a leftover token fails the build. Every substituted value
 * comes from the build's own tables (networks.ts, origins.json) or is a URL host name, never from user input.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { networkFor } from '../src/config/networks.ts';
import { parseEnv } from '../src/config/schema.ts';
import { moveNoticeActive, type LaunchDates } from '../src/config/launch.ts';

export interface CopyContext {
  chainId: number;
  rpId: string;
  /** Build time (ms), for the dated "moving" block. */
  now: number;
  rpc: { host: string; vendor: string };
  /** Test override of the committed launch dates (src/config/launch.ts). */
  dates?: LaunchDates;
}

interface OriginsInventory {
  origins: Record<string, { vendor: string }>;
}

const BLOCK = /<!--net:([a-z-]*)-->([\s\S]*?)<!--\/net-->/g;

function keep(kind: string, ctx: CopyContext): boolean {
  const status = networkFor(ctx.chainId).status;
  switch (kind) {
    case 'testnet':
      return status === 'testnet';
    case 'mainnet':
      return status === 'mainnet';
    case 'moving':
      return moveNoticeActive({ now: ctx.now, chainId: ctx.chainId, rpId: ctx.rpId, ...(ctx.dates ? { dates: ctx.dates } : {}) });
    default:
      throw new Error(`[network-copy] unknown network block "${kind}"`);
  }
}

export function resolveNetworkCopy(text: string, ctx: CopyContext): string {
  const out = text
    .replace(BLOCK, (_m, kind: string, body: string) => {
      if (body.includes('<!--net:')) throw new Error('[network-copy] nested network block');
      return keep(kind, ctx) ? body : '';
    })
    .replaceAll('__CS_NET_NAME__', networkFor(ctx.chainId).shortName)
    .replaceAll('__CS_RPC_HOST__', ctx.rpc.host)
    .replaceAll('__CS_RPC_VENDOR__', ctx.rpc.vendor);
  if (/<!--\/?net[:-]/.test(out)) throw new Error('[network-copy] unclosed or stray network block marker');
  const token = out.match(/__CS_(NET|RPC)_[A-Z_]*__/);
  if (token) throw new Error(`[network-copy] unknown token ${token[0]}`);
  return out;
}

/** 4.4: the RPC row of the privacy policy. The origin must be in the data-flow inventory, or the build fails. */
export function rpcDisclosure(rpcUrl: string, inventory: OriginsInventory): { host: string; vendor: string } {
  const url = new URL(rpcUrl);
  const host = url.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.invalid')) {
    return { host, vendor: 'Local test endpoint, never used in production' };
  }
  const row = inventory.origins[url.origin];
  if (!row) {
    throw new Error(`[network-copy] VITE_RPC_URL host ${host} is not in docs/compliance/origins.json, so the privacy policy can't disclose it; add its row first`);
  }
  return { host, vendor: row.vendor };
}

/** Validates the build variables first (the same ConfigError as the config plugin), then derives the copy context. */
export function copyContext(env: Record<string, string | undefined>, inventory: OriginsInventory, now: number): CopyContext {
  const { chainId, rpId, rpcUrl } = parseEnv(env);
  return { chainId, rpId, now, rpc: rpcDisclosure(rpcUrl, inventory) };
}

/** The data-flow inventory, next to the compliance records. */
export const readOriginsInventory = (root: string): OriginsInventory =>
  JSON.parse(readFileSync(join(root, '..', '..', 'docs', 'compliance', 'origins.json'), 'utf8')) as OriginsInventory;

/** Build time: SOURCE_DATE_EPOCH when set (reproducible builds), else now. */
export const buildTime = (): number => (process.env.SOURCE_DATE_EPOCH ? Number(process.env.SOURCE_DATE_EPOCH) * 1000 : Date.now());

/** llms.txt status line (add-llms-txt D2): restates the site's network and audit status. */
export function llmsStatus(ctx: CopyContext): string {
  const net = networkFor(ctx.chainId);
  const intro = 'CryoShield is a free, open-source project with no company behind it.';
  if (net.status === 'testnet') {
    return `${intro} It is a testnet preview: vaults are stored on ${net.shortName}, a test network, with an extra copy on Arweave when that upload succeeds. Test networks can be reset, and CryoShield has not been independently audited yet.`;
  }
  return `${intro} Vaults are stored on ${net.shortName}, with an extra copy on Arweave when that upload succeeds. CryoShield has not been independently audited. Only the security keys enrolled for a vault can open it: if you lose every key, nobody can open it.`;
}

/** Resolves the network blocks of every HTML page, after the legal plugin has injected the partials. */
export function networkCopyPlugin(ctx: CopyContext): Plugin {
  return {
    name: 'cryoshield-network-copy',
    transformIndexHtml: { order: 'pre', handler: (html) => resolveNetworkCopy(html, ctx) },
  };
}

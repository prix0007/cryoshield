// @vitest-environment node
/**
 * launch-op-mainnet D6: one build-time mechanism makes the public copy follow the build's chain. Pages and legal
 * Markdown carry `<!--net:testnet-->…<!--/net-->`, `<!--net:mainnet-->…<!--/net-->` and `<!--net:moving-->…<!--/net-->`
 * blocks plus a few tokens; the build keeps the blocks for its network and substitutes the tokens. Anything left over
 * fails the build.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyContext, llmsStatus, resolveNetworkCopy, rpcDisclosure, type CopyContext } from '../../vite-plugins/network-copy';

const inventory = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', 'docs', 'compliance', 'origins.json'), 'utf8'));
const ctx = (chainId: number, over: Partial<CopyContext> = {}): CopyContext => ({
  chainId,
  rpId: 'cryoshield.app',
  now: Date.parse('2026-10-09T00:00:00Z'),
  rpc: { host: 'rpc.example', vendor: 'Example RPC' },
  ...over,
});
const SRC = 'a <!--net:testnet-->T on __CS_NET_NAME__<!--/net--><!--net:mainnet-->M on __CS_NET_NAME__<!--/net--> b';

describe('resolveNetworkCopy', () => {
  it('keeps the testnet blocks on a testnet, with its name', () => {
    expect(resolveNetworkCopy(SRC, ctx(11155420))).toBe('a T on OP Sepolia b');
    expect(resolveNetworkCopy(SRC, ctx(31337))).toBe('a T on a local test chain b');
  });

  it('keeps the mainnet blocks on a mainnet, with its name', () => {
    expect(resolveNetworkCopy(SRC, ctx(10))).toBe('a M on OP Mainnet b');
  });

  it('treats an unknown chain as a testnet (fail safe)', () => {
    expect(resolveNetworkCopy(SRC, ctx(999))).toBe('a T on chain 999 b');
  });

  it('spans lines, and substitutes the RPC host and vendor', () => {
    const md = '| RPC | <!--net:testnet-->\nOld<!--/net-->__CS_RPC_VENDOR__ (`__CS_RPC_HOST__`) |';
    expect(resolveNetworkCopy(md, ctx(10, { rpc: { host: 'mainnet.optimism.io', vendor: 'OP Labs' } }))).toBe('| RPC | OP Labs (`mainnet.optimism.io`) |');
  });

  it('keeps the "moving" block only while the production testnet build is in the notice window', () => {
    const src = 'x<!--net:moving--> moving<!--/net-->';
    const dates = { moveNoticeFrom: '2026-10-01', switchDate: '2026-10-20' };
    expect(resolveNetworkCopy(src, ctx(11155420, { dates }))).toBe('x moving');
    expect(resolveNetworkCopy(src, ctx(11155420, { dates, rpId: 'cryoshield-web-dev.fly.dev' }))).toBe('x');
    expect(resolveNetworkCopy(src, ctx(10, { dates }))).toBe('x');
    expect(resolveNetworkCopy(src, ctx(11155420))).toBe('x'); // the committed dates are unset
  });

  it('fails on an unknown block, a nested or unclosed block, or a leftover token', () => {
    expect(() => resolveNetworkCopy('<!--net:beta-->x<!--/net-->', ctx(10))).toThrow(/unknown network block "beta"/);
    expect(() => resolveNetworkCopy('<!--net:testnet-->a<!--net:mainnet-->b<!--/net--><!--/net-->', ctx(10))).toThrow(/network block/);
    expect(() => resolveNetworkCopy('<!--net:testnet-->a', ctx(10))).toThrow(/network block/);
    expect(() => resolveNetworkCopy('a<!--/net-->', ctx(10))).toThrow(/network block/);
    expect(() => resolveNetworkCopy('__CS_NET_OTHER__', ctx(10))).toThrow(/__CS_NET_OTHER__/);
  });
});

describe('rpcDisclosure (4.4: the privacy sub-processor row names the configured RPC host)', () => {
  it('names the host and the vendor recorded in docs/compliance/origins.json', () => {
    expect(rpcDisclosure('https://mainnet.optimism.io', inventory)).toEqual({ host: 'mainnet.optimism.io', vendor: 'OP Labs public RPC (OP Mainnet)' });
    expect(rpcDisclosure('https://sepolia.optimism.io/', inventory)).toEqual({ host: 'sepolia.optimism.io', vendor: 'OP Labs public RPC (OP Sepolia)' });
  });

  it('fails the build, naming the host, when the RPC is not in the inventory', () => {
    expect(() => rpcDisclosure('https://rpc.unlisted.example/v1', inventory)).toThrow(/rpc\.unlisted\.example/);
  });

  it('labels loopback and .invalid fixture endpoints as test endpoints', () => {
    expect(rpcDisclosure('http://127.0.0.1:8545', inventory)).toEqual({ host: '127.0.0.1', vendor: 'Local test endpoint, never used in production' });
    expect(rpcDisclosure('https://rpc.verify.invalid', inventory).vendor).toMatch(/test endpoint/i);
  });
});

describe('copyContext', () => {
  it('derives the context from the build variables and the inventory', () => {
    const env = {
      VITE_CHAIN_ID: '10',
      VITE_RPC_URL: 'https://mainnet.optimism.io/',
      VITE_BUNDLER_URL: 'https://api.pimlico.io/v2/10/rpc?apikey=pim_test',
      VITE_SPONSORSHIP_POLICY_ID: 'sp_test',
      VITE_TURBO_UPLOAD_URL: 'https://upload.ardrive.io',
      VITE_ARWEAVE_GATEWAY_URL: 'https://arweave.net',
      VITE_RP_ID: 'cryoshield.app',
      VITE_RP_NAME: 'CryoShield',
    };
    const c = copyContext(env, inventory, 1234);
    expect(c).toEqual({ chainId: 10, rpId: 'cryoshield.app', now: 1234, rpc: { host: 'mainnet.optimism.io', vendor: 'OP Labs public RPC (OP Mainnet)' } });
    expect(() => copyContext({ ...env, VITE_RPC_URL: '' }, inventory, 1)).toThrow(/Missing required build variable/);
  });
});

describe('llms.txt status line', () => {
  it('restates the testnet banner on a testnet', () => {
    const s = llmsStatus(ctx(11155420));
    expect(s).toMatch(/testnet preview/);
    expect(s).toMatch(/OP Sepolia, a test network/);
    expect(s).toMatch(/not been independently audited/);
  });

  it('names OP Mainnet, the audit status and the all-keys-lost rule on OP Mainnet, and no testnet', () => {
    const s = llmsStatus(ctx(10));
    expect(s).toMatch(/OP Mainnet/);
    expect(s).toMatch(/not been independently audited/);
    expect(s).toMatch(/lose every key/);
    expect(s).not.toMatch(/testnet|OP Sepolia/i);
  });
});

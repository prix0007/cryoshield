#!/usr/bin/env node
/**
 * Publishable release manifest (security-review-hosting fix 2). Deterministic: no timestamps, sorted paths.
 *   treeHash = sha256 over the lines "<sha256>  <path>\n" (exactly `shasum -a 256` output) for every served file,
 *              paths relative to the site root, sorted bytewise (LC_ALL=C).
 * Anyone can rebuild the tagged commit with the published config and compare (see deploy/README.md).
 * Never records key values: only chain ID, RP ID, registry records (every version, newest first, in `registries`; v1 and
 * v2 also in the legacy `registry`/`registryV2` fields), this RP ID's wallet pair, and connect-src ORIGINS.
 * Usage: node deploy/release-manifest.mjs --site deploy/.build/site --out <file> --commit <sha> --env .env --contracts ../../contracts [--site-release]
 *   --site-release also writes <site>/release.json (served as /release.json; excluded from treeHash).
 *   --caddyfile <path> records the sha256 of the generated Caddyfile (CSP and every response header).
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { keccak256 } from 'viem';
import { registryList } from '../vite-plugins/registries.mjs';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`missing --${name}`);
  return process.argv[i + 1];
}
const site = arg('site');
const out = arg('out');
const commit = arg('commit');
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('--commit must be a full 40-hex git commit');

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [relative(site, p).split(sep).join('/')];
  });
}
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
// add-continuous-deploy: release.json is published INTO the site after hashing, so it must not be hashed itself.
if (existsSync(join(site, 'release.json'))) throw new Error(`${site}/release.json already exists; regenerate the site first`);
// Byte-wise, exactly like LC_ALL=C sort (ECC review #10: `<` on Buffers compares UTF-16 strings, not bytes).
const paths = walk(site).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
const files = paths.map((path) => ({ path, sha256: sha256(readFileSync(join(site, path))) }));
const treeHash = `sha256:${sha256(files.map((f) => `${f.sha256}  ${f.path}\n`).join(''))}`;

const env = Object.fromEntries(
  readFileSync(arg('env'), 'utf8')
    .split('\n')
    .filter((l) => /^VITE_[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
// Chain presets (apps/web/.env.example); RP ID must be a bare lower-case hostname (ECC review #10).
const CHAIN_PRESETS = [11155420, 10, 421614, 42161, 31337];
if (!/^[0-9]+$/.test(env.VITE_CHAIN_ID ?? '') || !CHAIN_PRESETS.includes(Number(env.VITE_CHAIN_ID))) {
  throw new Error(`VITE_CHAIN_ID must be a decimal chain id from the presets (${CHAIN_PRESETS.join(', ')}), got ${JSON.stringify(env.VITE_CHAIN_ID ?? null)}`);
}
if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(env.VITE_RP_ID ?? '')) {
  throw new Error(`VITE_RP_ID must be a hostname, got ${JSON.stringify(env.VITE_RP_ID ?? null)}`);
}
const chainId = Number(env.VITE_CHAIN_ID);
const recordPath = join(arg('contracts'), 'deployments', `${chainId}.json`);
const record = JSON.parse(readFileSync(recordPath, 'utf8'));
// web-registry-versions D4: the build's own parser (an unknown version fails here too, never published).
const abiHash = (f) => keccak256(new Uint8Array(readFileSync(join(arg('contracts'), 'abi', f))));
const registries = registryList(record, recordPath, { 1: abiHash('VaultRegistry.json'), 2: abiHash('VaultRegistryV2.json') });
// The legacy v1/v2 fields come from the same parsed list, whichever record key named them.
const v1 = registries.find((r) => r.n === 1);
const v2 = registries.find((r) => r.n === 2);
// harden-gas-sponsorship: the build already refused a record without these; the manifest names them too.
const wallet = record.contracts?.wallets?.[env.VITE_RP_ID];
if (!v2 || !wallet) throw new Error(`deployments/${chainId}.json has no VaultRegistry v2 or contracts.wallets["${env.VITE_RP_ID}"]`);
const html = readFileSync(join(site, 'index.html'), 'utf8');
const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1] ?? '';
const connect = (csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('connect-src ')) ?? '')
  .split(/\s+/)
  .slice(1)
  .filter((o) => o !== "'self'")
  .map((o) => new URL(o).origin); // origins only: never paths or query strings (API keys)

const caddyIdx = process.argv.indexOf('--caddyfile');
const caddyfile = caddyIdx >= 0 ? `sha256:${sha256(readFileSync(arg('caddyfile')))}` : undefined;
const manifest = {
  name: 'cryoshield-web',
  commit,
  treeHash,
  ...(caddyfile ? { caddyfile } : {}),
  config: {
    chainId,
    rpId: env.VITE_RP_ID,
    // VaultRegistry v1 (legacy reads); null where v1 was never deployed (OP Mainnet).
    registry: v1 ? { address: v1.address, deployBlock: v1.deployBlock } : null,
    registryV2: { address: v2.address, deployBlock: v2.deployBlock },
    // Every registry, newest first; the first takes every write (the recovery tool reads this list, D5 of
    // recover-registry-versions). The two fields above stay for the smoke test and older recovery tools.
    registries: registries.map(({ version, address, deployBlock, abiHash }) => ({ version, address, deployBlock, abiHash })),
    wallet: { factory: wallet.factory, implementation: wallet.implementation },
    connectOrigins: connect,
  },
  files,
};
writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
if (process.argv.includes('--site-release')) {
  // Served as /release.json (add-continuous-deploy D3): which commit is live, its treeHash and the public config.
  // No file list (that stays in the full manifest) and, like the manifest, no key values.
  const identity = { name: manifest.name, commit: manifest.commit, treeHash: manifest.treeHash, ...(caddyfile ? { caddyfile } : {}), config: manifest.config };
  writeFileSync(join(site, 'release.json'), JSON.stringify(identity, null, 2) + '\n');
}
console.log(`release ${commit.slice(0, 12)} treeHash ${treeHash} (${files.length} files) -> ${out}`);

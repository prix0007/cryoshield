#!/usr/bin/env node
/**
 * Publishable release manifest (security-review-hosting fix 2). Deterministic: no timestamps, sorted paths.
 *   treeHash = sha256 over the lines "<sha256>  <path>\n" (exactly `shasum -a 256` output) for every served file,
 *              paths relative to the site root, sorted bytewise (LC_ALL=C).
 * Anyone can rebuild the tagged commit with the published config and compare (see deploy/README.md).
 * Never records key values: only chain ID, RP ID, registry record, and connect-src ORIGINS.
 * Usage: node deploy/release-manifest.mjs --site deploy/.build/site --out <file> --commit <sha> --env .env --contracts ../../contracts
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

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
const paths = walk(site).sort((a, b) => (Buffer.from(a) < Buffer.from(b) ? -1 : Buffer.from(a) > Buffer.from(b) ? 1 : 0));
const files = paths.map((path) => ({ path, sha256: sha256(readFileSync(join(site, path))) }));
const treeHash = `sha256:${sha256(files.map((f) => `${f.sha256}  ${f.path}\n`).join(''))}`;

const env = Object.fromEntries(
  readFileSync(arg('env'), 'utf8')
    .split('\n')
    .filter((l) => /^VITE_[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const chainId = Number(env.VITE_CHAIN_ID);
const record = JSON.parse(readFileSync(join(arg('contracts'), 'deployments', `${chainId}.json`), 'utf8'));
const html = readFileSync(join(site, 'index.html'), 'utf8');
const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1] ?? '';
const connect = (csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('connect-src ')) ?? '')
  .split(/\s+/)
  .slice(1)
  .filter((o) => o !== "'self'")
  .map((o) => new URL(o).origin); // origins only: never paths or query strings (API keys)

const manifest = {
  name: 'cryoshield-web',
  commit,
  treeHash,
  config: {
    chainId,
    rpId: env.VITE_RP_ID,
    registry: { address: record.address, deployBlock: record.deployBlock },
    connectOrigins: connect,
  },
  files,
};
writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
console.log(`release ${commit.slice(0, 12)} treeHash ${treeHash} (${files.length} files) -> ${out}`);

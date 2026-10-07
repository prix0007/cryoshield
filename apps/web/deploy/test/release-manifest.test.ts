// @vitest-environment node
/** Review fix 2: publishable, deterministic release manifest (no key values). */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keccak256, toHex } from 'viem';
import { describe, expect, it } from 'vitest';

const SCRIPT = join(__dirname, '..', 'release-manifest.mjs');
// web-registry-versions D4: the manifest reads registries with the build's parser, so the fixture has real ABI files.
const ABI1 = '[{"type":"function","name":"v1"}]';
const ABI2 = '[{"type":"function","name":"v2"}]';
const H1 = keccak256(toHex(ABI1));
const H2 = keccak256(toHex(ABI2));
const A3 = '0x00000000000000000000000000000000000000a3';
const CSP = "default-src 'none'; connect-src 'self' https://sepolia.optimism.io https://api.pimlico.io https://upload.ardrive.io https://arweave.net";

function fixture(order: string[], extra: Record<string, unknown> = {}) {
  const d = mkdtempSync(join(tmpdir(), 'cs-man-'));
  const site = join(d, 'site');
  mkdirSync(join(site, 'assets'), { recursive: true });
  const content: Record<string, string> = {
    'index.html': `<html><head><meta http-equiv="Content-Security-Policy" content="${CSP}"></head></html>`,
    'assets/index-abc.js': 'console',
    'assets/index-def.css': 'body{}',
  };
  for (const f of order) writeFileSync(join(site, f), content[f]!);
  writeFileSync(
    join(d, '.env'),
    'VITE_CHAIN_ID=11155420\nVITE_RP_ID=cryoshield.app\nVITE_BUNDLER_URL=https://api.pimlico.io/v2/11155420/rpc?apikey=pim_SECRETISH\nVITE_SPONSORSHIP_POLICY_ID=sp_hidden\n',
  );
  mkdirSync(join(d, 'contracts', 'deployments'), { recursive: true });
  mkdirSync(join(d, 'contracts', 'abi'), { recursive: true });
  writeFileSync(join(d, 'contracts', 'abi', 'VaultRegistry.json'), ABI1);
  writeFileSync(join(d, 'contracts', 'abi', 'VaultRegistryV2.json'), ABI2);
  writeFileSync(
    join(d, 'contracts', 'deployments', '11155420.json'),
    JSON.stringify({
      chainId: 11155420,
      address: '0xB43f58cF17e64B603aE5588a1DD17E96a0849e44',
      deployBlock: 7,
      txHash: '0x',
      abiHash: H1,
      contracts: {
        vaultRegistryV2: { address: '0x00000000000000000000000000000000000000a2', deployBlock: 9, txHash: '0x', abiHash: H2 },
        ...extra,
        wallets: {
          'cryoshield.app': { factory: '0x00000000000000000000000000000000000000f1', implementation: '0x00000000000000000000000000000000000000e1', rpIdHash: '0x', deployBlock: 9, txHash: '0x', abiHash: '0x', factoryAbiHash: '0x' },
          'cryoshield-web-dev.fly.dev': { factory: '0x00000000000000000000000000000000000000f2', implementation: '0x00000000000000000000000000000000000000e2', rpIdHash: '0x', deployBlock: 9, txHash: '0x', abiHash: '0x', factoryAbiHash: '0x' },
        },
      },
    }),
  );
  return d;
}
const run = (d: string, commit = 'a'.repeat(40)) => {
  const out = join(d, 'release-manifest.json');
  const stdout = execFileSync('node', [SCRIPT, '--site', join(d, 'site'), '--out', out, '--commit', commit, '--env', join(d, '.env'), '--contracts', join(d, 'contracts')], { encoding: 'utf8' });
  return { stdout, json: readFileSync(out, 'utf8') };
};

describe('release manifest', () => {
  it('is deterministic (byte-identical across runs and file creation order) and has no timestamps', () => {
    const a = run(fixture(['index.html', 'assets/index-abc.js', 'assets/index-def.css']));
    const b = run(fixture(['assets/index-def.css', 'assets/index-abc.js', 'index.html']));
    expect(a.json).toBe(b.json);
    expect(a.json).not.toMatch(/generated|time|date/i);
  });

  it('treeHash = sha256 of the sorted `sha256sum` lines, reproducible with coreutils', () => {
    const d = fixture(['index.html', 'assets/index-abc.js', 'assets/index-def.css']);
    const m = JSON.parse(run(d).json);
    const shell = execFileSync('sh', ['-c', `cd "${join(d, 'site')}" && find . -type f | sed 's#^\\./##' | LC_ALL=C sort | while read f; do shasum -a 256 "$f"; done | shasum -a 256 | cut -d' ' -f1`], { encoding: 'utf8' }).trim();
    expect(m.treeHash).toBe(`sha256:${shell}`);
    expect(m.files.map((f: { path: string }) => f.path)).toEqual(['assets/index-abc.js', 'assets/index-def.css', 'index.html']);
    expect(m.files[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('records commit and a config summary but never key values', () => {
    const d = fixture(['index.html', 'assets/index-abc.js', 'assets/index-def.css']);
    const { stdout, json } = run(d, 'b'.repeat(40));
    const m = JSON.parse(json);
    expect(m.commit).toBe('b'.repeat(40));
    expect(m.config).toEqual({
      chainId: 11155420,
      rpId: 'cryoshield.app',
      registry: { address: '0xB43f58cF17e64B603aE5588a1DD17E96a0849e44', deployBlock: 7 },
      // harden-gas-sponsorship: the registry every write targets, and this RP ID's wallet pair (never another's).
      registryV2: { address: '0x00000000000000000000000000000000000000a2', deployBlock: 9 },
      wallet: { factory: '0x00000000000000000000000000000000000000f1', implementation: '0x00000000000000000000000000000000000000e1' },
      // web-registry-versions D4: every registry, newest first (config.registry and config.registryV2 stay for one release).
      registries: [
        { version: 'v2', address: '0x00000000000000000000000000000000000000a2', deployBlock: 9, abiHash: H2 },
        { version: 'v1', address: '0xB43f58cF17e64B603aE5588a1DD17E96a0849e44', deployBlock: 7, abiHash: H1 },
      ],
      connectOrigins: ['https://sepolia.optimism.io', 'https://api.pimlico.io', 'https://upload.ardrive.io', 'https://arweave.net'],
    });
    expect(json).not.toMatch(/pim_|apikey|sp_hidden/);
    expect(stdout).toContain(m.treeHash);
  });

  it('--site-release publishes site/release.json (identity + config, no file list, no keys) without changing treeHash (add-continuous-deploy 1.1)', () => {
    const d = fixture(['index.html', 'assets/index-abc.js', 'assets/index-def.css']);
    const before = JSON.parse(run(d, 'c'.repeat(40)).json);
    const out = join(d, 'release-manifest.json');
    execFileSync('node', [SCRIPT, '--site', join(d, 'site'), '--out', out, '--commit', 'c'.repeat(40), '--env', join(d, '.env'), '--contracts', join(d, 'contracts'), '--site-release'], { encoding: 'utf8' });
    const after = JSON.parse(readFileSync(out, 'utf8'));
    const pub = readFileSync(join(d, 'site', 'release.json'), 'utf8');
    const rel = JSON.parse(pub);
    expect(after.treeHash).toBe(before.treeHash);
    expect(after.files.map((f: { path: string }) => f.path)).not.toContain('release.json');
    expect(rel).toEqual({ name: 'cryoshield-web', commit: 'c'.repeat(40), treeHash: before.treeHash, config: before.config });
    expect(pub).not.toMatch(/pim_|apikey|sp_hidden/);
  });

  it('sorts paths byte-wise like LC_ALL=C sort, also for non-ASCII names (ECC #10)', () => {
    const d = fixture(['index.html', 'assets/index-abc.js', 'assets/index-def.css']);
    // U+FF21 (UTF-8 ef bc a1) sorts after U+00E9 (c3 a9) by bytes, but before an astral char by UTF-16 code units.
    for (const f of ['assets/\u{1F600}.txt', 'assets/Ａ.txt', 'assets/é.txt']) writeFileSync(join(d, 'site', f), f);
    const m = JSON.parse(run(d).json);
    const paths = m.files.map((f: { path: string }) => f.path);
    const bytewise = [...paths].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    expect(paths).toEqual(bytewise);
    const shell = execFileSync('sh', ['-c', `cd "${join(d, 'site')}" && find . -type f | sed 's#^\\./##' | LC_ALL=C sort | while read f; do shasum -a 256 "$f"; done | shasum -a 256 | cut -d' ' -f1`], { encoding: 'utf8' }).trim();
    expect(m.treeHash).toBe(`sha256:${shell}`);
  });

  it('refuses an unknown or non-decimal VITE_CHAIN_ID and a missing or invalid VITE_RP_ID (ECC #10)', () => {
    for (const env of ['VITE_CHAIN_ID=0x1\nVITE_RP_ID=cryoshield.app\n', 'VITE_CHAIN_ID=1\nVITE_RP_ID=cryoshield.app\n', 'VITE_RP_ID=cryoshield.app\n',
      'VITE_CHAIN_ID=11155420\n', 'VITE_CHAIN_ID=11155420\nVITE_RP_ID=https://cryoshield.app\n', 'VITE_CHAIN_ID=11155420\nVITE_RP_ID=Cryo Shield\n']) {
      const d = fixture(['index.html', 'assets/index-abc.js', 'assets/index-def.css']);
      writeFileSync(join(d, '.env'), env);
      expect(() => run(d), env).toThrow(/VITE_CHAIN_ID|VITE_RP_ID/);
    }
  });

  it('hashes the Caddyfile (response headers, CSP) into the manifest when given (ECC #5)', () => {
    const d = fixture(['index.html', 'assets/index-abc.js', 'assets/index-def.css']);
    writeFileSync(join(d, 'Caddyfile'), ':8080 {\n}\n');
    const out = join(d, 'release-manifest.json');
    execFileSync('node', [SCRIPT, '--site', join(d, 'site'), '--out', out, '--commit', 'e'.repeat(40), '--env', join(d, '.env'), '--contracts', join(d, 'contracts'), '--caddyfile', join(d, 'Caddyfile'), '--site-release'], { encoding: 'utf8' });
    const m = JSON.parse(readFileSync(out, 'utf8'));
    const shell = execFileSync('sh', ['-c', `shasum -a 256 "${join(d, 'Caddyfile')}" | cut -d' ' -f1`], { encoding: 'utf8' }).trim();
    expect(m.caddyfile).toBe(`sha256:${shell}`);
    expect(JSON.parse(readFileSync(join(d, 'site', 'release.json'), 'utf8')).caddyfile).toBe(m.caddyfile);
  });

  it('3-registry record: a fake v3 with v2\'s ABI is listed first; the legacy v1/v2 fields are unchanged', () => {
    const d = fixture(['index.html', 'assets/index-abc.js', 'assets/index-def.css'], { vaultRegistries: { v3: { address: A3, deployBlock: 12, txHash: '0x', abiHash: H2 } } });
    const m = JSON.parse(run(d).json);
    expect(m.config.registries.map((r: { version: string; address: string; abiHash: string }) => [r.version, r.address, r.abiHash])).toEqual([
      ['v3', A3, H2],
      ['v2', '0x00000000000000000000000000000000000000a2', H2],
      ['v1', '0xB43f58cF17e64B603aE5588a1DD17E96a0849e44', H1],
    ]);
    expect(m.config.registryV2).toEqual({ address: '0x00000000000000000000000000000000000000a2', deployBlock: 9 });
    expect(m.config.registry).toEqual({ address: '0xB43f58cF17e64B603aE5588a1DD17E96a0849e44', deployBlock: 7 });
    expect(Object.keys(m.config)).toEqual(['chainId', 'rpId', 'registry', 'registryV2', 'registries', 'wallet', 'connectOrigins']);
  });

  it('refuses a registry version the app does not know instead of publishing it', () => {
    const d = fixture(['index.html', 'assets/index-abc.js', 'assets/index-def.css'], { vaultRegistries: { v3: { address: A3, deployBlock: 12, txHash: '0x', abiHash: '0x' + '99'.repeat(32) } } });
    expect(() => run(d)).toThrow(/doesn't know VaultRegistry v3/);
  });

  it('refuses to run twice into a site that already has release.json (it would hash itself)', () => {
    const d = fixture(['index.html', 'assets/index-abc.js', 'assets/index-def.css']);
    writeFileSync(join(d, 'site', 'release.json'), '{}');
    expect(() => run(d)).toThrow(/release\.json/);
  });
});

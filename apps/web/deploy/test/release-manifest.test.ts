// @vitest-environment node
/** Review fix 2: publishable, deterministic release manifest (no key values). */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = join(__dirname, '..', 'release-manifest.mjs');
const CSP = "default-src 'none'; connect-src 'self' https://sepolia.optimism.io https://api.pimlico.io https://upload.ardrive.io https://arweave.net";

function fixture(order: string[]) {
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
  writeFileSync(join(d, 'contracts', 'deployments', '11155420.json'), JSON.stringify({ chainId: 11155420, address: '0xB43f58cF17e64B603aE5588a1DD17E96a0849e44', deployBlock: 7, txHash: '0x', abiHash: '0xab' }));
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

  it('refuses to run twice into a site that already has release.json (it would hash itself)', () => {
    const d = fixture(['index.html', 'assets/index-abc.js', 'assets/index-def.css']);
    writeFileSync(join(d, 'site', 'release.json'), '{}');
    expect(() => run(d)).toThrow(/release\.json/);
  });
});

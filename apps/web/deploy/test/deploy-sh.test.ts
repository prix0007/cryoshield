// @vitest-environment node
/** add-fly-hosting 3.2: deploy.sh refuses unsafe deploys; on success, steps run in order and end with fly deploy. */
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = join(__dirname, '..', 'deploy.sh');

function repo(rpId = 'cryoshield.app') {
  const root = mkdtempSync(join(tmpdir(), 'cs-deploy-'));
  const web = join(root, 'apps', 'web');
  mkdirSync(join(web, 'deploy'), { recursive: true });
  cpSync(SCRIPT, join(web, 'deploy', 'deploy.sh'));
  writeFileSync(join(web, '.env'), `VITE_CHAIN_ID=11155420\nVITE_RP_ID=${rpId}\n`);
  writeFileSync(join(root, '.gitignore'), '.env\n');
  writeFileSync(join(web, 'fly.toml'), 'app = "cryoshield-web"\n');
  const bin = join(root, 'stub-bin');
  mkdirSync(bin);
  const log = join(root, 'calls.log');
  for (const tool of ['pnpm', 'node', 'fly']) {
    const p = join(bin, tool);
    writeFileSync(p, `#!/bin/sh\necho "${tool} $*" >> "${log}"\nif [ "${tool}" = node ] && [ -n "$STUB_VERIFY_FAIL" ] && echo "$*" | grep -q verify-build; then echo "FAIL bundle RP ID x != y" >&2; exit 1; fi\nexit 0\n`);
    chmodSync(p, 0o755);
  }
  const git = (...a: string[]) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const run = (env: Record<string, string> = {}, args: string[] = []) => {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITE_')));
    return spawnSync('bash', [join(web, 'deploy', 'deploy.sh'), ...args], {
      cwd: web,
      encoding: 'utf8',
      env: { ...clean, PATH: `${bin}:/usr/bin:/bin`, ...env },
    });
  };
  const calls = () => {
    try {
      return readFileSync(log, 'utf8').trim().split('\n');
    } catch {
      return [];
    }
  };
  return { root, web, bin, run, calls };
}

describe('deploy.sh guards', () => {
  it('refuses a dirty tree (untracked file) and never calls fly or builds', () => {
    const r = repo();
    writeFileSync(join(r.web, 'stray.txt'), 'x');
    const out = r.run();
    expect(out.status).not.toBe(0);
    expect(out.stderr).toMatch(/not clean/);
    expect(r.calls()).toEqual([]);
  });

  it('refuses a modified tracked file', () => {
    const r = repo();
    writeFileSync(join(r.web, 'fly.toml'), 'app = "other"\n');
    const out = r.run();
    expect(out.status).not.toBe(0);
    expect(r.calls()).toEqual([]);
  });

  it('refuses when VITE_RP_ID differs from the deploy host, naming both', () => {
    const r = repo('example.com');
    const out = r.run();
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain('VITE_RP_ID (example.com) != deploy host (cryoshield.app)');
    expect(r.calls()).toEqual([]);
  });

  it('refuses VITE_* variables in the environment (they would override .env)', () => {
    const r = repo();
    const out = r.run({ VITE_RP_ID: 'cryoshield.app' });
    expect(out.status).not.toBe(0);
    expect(out.stderr).toMatch(/VITE_/);
    expect(r.calls()).toEqual([]);
  });

  it('stops before fly when verify-build (bundle RP ID / reproducibility) fails', () => {
    const r = repo();
    const out = r.run({ STUB_VERIFY_FAIL: '1' });
    expect(out.status).not.toBe(0);
    expect(r.calls().some((c) => c.startsWith('fly'))).toBe(false);
  });

  it.each(['.env.local', '.env.production', '.env.production.local', '.env.e2e.local'])('refuses when %s exists (would shadow .env in a production build)', (f) => {
    const r = repo();
    writeFileSync(join(r.web, f), 'VITE_RP_ID=evil.example\n');
    // keep the tree clean: these files are git-ignored in the real repo
    writeFileSync(join(r.root, '.gitignore'), '.env\n.env.*\n');
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'ignore'], { cwd: r.root });
    const out = r.run();
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain(f);
    expect(r.calls()).toEqual([]);
  });

  it('on a clean tree with a matching host, verifies, generates, then deploys', () => {
    const r = repo();
    const out = r.run();
    expect(out.status, out.stderr).toBe(0);
    expect(r.calls()).toEqual([
      'node scripts/verify-build.mjs --real-env --expect-host cryoshield.app',
      'node deploy/gen-context.mjs --dist dist --out deploy/.build --host cryoshield.app',
      expect.stringMatching(/^node deploy\/release-manifest\.mjs --site deploy\/\.build\/site --out deploy\/\.build\/release-manifest\.json --commit [0-9a-f]{40} --env \.env --contracts .+\/contracts --caddyfile deploy\/\.build\/Caddyfile --site-release$/),
      'fly deploy --config fly.toml --remote-only --app cryoshield-web',
    ]);
  });

  it('--build-only runs every guard and build step but never fly, and does not need fly (add-continuous-deploy H1)', () => {
    const r = repo();
    rmSync(join(r.bin, 'fly'));
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'no fly'], { cwd: r.root });
    const out = r.run({}, ['--build-only']);
    expect(out.status, out.stderr).toBe(0);
    expect(r.calls().some((c) => c.startsWith('fly'))).toBe(false);
    expect(r.calls()).toHaveLength(3);
    expect(out.stdout).toMatch(/build only/);
  });

  it('rejects unknown arguments', () => {
    const r = repo();
    const out = r.run({}, ['--deploy-anyway']);
    expect(out.status).not.toBe(0);
    expect(r.calls()).toEqual([]);
  });
});

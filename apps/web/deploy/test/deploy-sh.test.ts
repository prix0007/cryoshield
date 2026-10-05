// @vitest-environment node
/** add-fly-hosting 3.2: deploy.sh refuses unsafe deploys; on success, steps run in order and end with fly deploy. */
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = join(__dirname, '..', 'deploy.sh');

// Hermetic (L5): no inherited VITE_* (would override .env), DEPLOY_* (would change the target) or GIT_* (GIT_DIR,
// GIT_WORK_TREE, GIT_INDEX_FILE... would point git at another repository, e.g. when run from a git hook).
const HERMETIC = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(VITE|DEPLOY|GIT)_/.test(k)));

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
  const git = (...a: string[]) => spawnSync('git', a, { cwd: root, encoding: 'utf8', env: HERMETIC });
  git('init', '-q');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const run = (env: Record<string, string> = {}, args: string[] = []) => {
    const clean = HERMETIC;
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
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'ignore'], { cwd: r.root, env: HERMETIC });
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
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'no fly'], { cwd: r.root, env: HERMETIC });
    const out = r.run({}, ['--build-only']);
    expect(out.status, out.stderr).toBe(0);
    expect(r.calls().some((c) => c.startsWith('fly'))).toBe(false);
    expect(r.calls()).toHaveLength(3);
    expect(r.calls()[1]).toBe('node deploy/gen-context.mjs --dist dist --out deploy/.build --host cryoshield.app');
    expect(out.stdout).toMatch(/build only/);
  });

  it('rejects unknown arguments', () => {
    const r = repo();
    const out = r.run({}, ['--deploy-anyway']);
    expect(out.status).not.toBe(0);
    expect(r.calls()).toEqual([]);
  });
});

describe('deploy.sh targets (split-dev-and-release-deploys)', () => {
  it('DEPLOY_TARGET=development: dev host, RP ID cryoshield-web-dev.fly.dev, --noindex, cryoshield-web-dev with fly.dev.toml', () => {
    const r = repo('cryoshield-web-dev.fly.dev');
    const out = r.run({ DEPLOY_TARGET: 'development' });
    expect(out.status, out.stderr).toBe(0);
    expect(r.calls()).toEqual([
      'node scripts/verify-build.mjs --real-env --expect-host cryoshield-web-dev.fly.dev',
      'node deploy/gen-context.mjs --dist dist --out deploy/.build --host cryoshield-web-dev.fly.dev --noindex',
      expect.stringMatching(/^node deploy\/release-manifest\.mjs .* --site-release$/),
      'fly deploy --config fly.dev.toml --remote-only --app cryoshield-web-dev',
    ]);
  });

  it.each(['cryoshield.app', 'dev.cryoshield.app', 'a.b.cryoshield.app'])('development refuses RP ID %s: the production RP ID or under it (T1: dev must never ask for production PRF outputs)', (rp) => {
    const r = repo(rp);
    const out = r.run({ DEPLOY_TARGET: 'development' }, ['--build-only']);
    expect(out.status).not.toBe(0);
    expect(out.stderr).toMatch(/production RP ID cryoshield\.app or under it/);
    expect(r.calls()).toEqual([]);
  });

  it('the development host itself is not under cryoshield.app (a different registrable domain)', () => {
    const sh = readFileSync(SCRIPT, 'utf8');
    const host = sh.match(/development\) HOST="([^"]+)"/)![1];
    expect(host).toBe('cryoshield-web-dev.fly.dev');
    expect(host === 'cryoshield.app' || host.endsWith('.cryoshield.app')).toBe(false);
    expect(sh).toMatch(/under_prod "\$HOST"/);
  });

  it('production (the default, or explicit) refuses the dev RP ID and never passes --noindex', () => {
    for (const env of [{}, { DEPLOY_TARGET: 'production' }]) {
      const bad = repo('cryoshield-web-dev.fly.dev');
      const out = bad.run(env, ['--build-only']);
      expect(out.status).not.toBe(0);
      expect(out.stderr).toContain('VITE_RP_ID (cryoshield-web-dev.fly.dev) != deploy host (cryoshield.app)');
      expect(bad.calls()).toEqual([]); // refused before any build step
      const ok = repo();
      expect(ok.run(env, ['--build-only']).status).toBe(0);
      expect(ok.calls().some((c) => c.includes('--noindex'))).toBe(false);
    }
  });

  it('an unknown DEPLOY_TARGET, or the retired DEPLOY_HOST, is refused before anything runs', () => {
    for (const env of [{ DEPLOY_TARGET: 'staging' }, { DEPLOY_TARGET: 'Production' }, { DEPLOY_HOST: 'cryoshield.app' }, { DEPLOY_HOST: 'cryoshield-web-dev.fly.dev', DEPLOY_TARGET: 'development' }]) {
      const r = repo();
      const out = r.run(env);
      expect(out.status, JSON.stringify(env)).not.toBe(0);
      expect(out.stderr).toMatch(/DEPLOY_TARGET|DEPLOY_HOST/);
      expect(r.calls()).toEqual([]);
    }
  });
});

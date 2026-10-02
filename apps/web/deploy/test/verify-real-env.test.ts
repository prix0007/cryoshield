// @vitest-environment node
/** add-fly-hosting 3.1: verify-build --real-env uses apps/web/.env, fails closed, and checks the bundle RP ID. */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const web = join(__dirname, '..', '..');
const run = (args: string[], env: Record<string, string> = {}) => {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITE_')));
  return spawnSync('node', ['scripts/verify-build.mjs', '--real-env', ...args], { cwd: web, encoding: 'utf8', env: { ...clean, NODE_ENV: 'production', ...env } });
};

describe('verify-build --real-env', () => {
  it('fails closed, naming the missing deployment record, while 11155420 is not deployed', () => {
    const r = run(['--expect-host', 'cryoshield.app'], { CRYOSHIELD_CONTRACTS_DIR: join(web, 'deploy', 'test', 'no-such-contracts') });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/deployments[/\\]\d+\.json/);
  });

  it('passes for a chain with a record, and checks the bundle RP ID against the host', () => {
    const ok = run(['--expect-host', 'cryoshield.app'], { VITE_CHAIN_ID: '31337' });
    expect(ok.stdout + ok.stderr).toContain('PASS verify-build');
    expect(ok.stdout).toContain('bundle RP ID == cryoshield.app');
    const bad = run(['--expect-host', 'example.com'], { VITE_CHAIN_ID: '31337' });
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain('bundle RP ID cryoshield.app != deploy host example.com');
  });
});

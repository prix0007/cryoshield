// @vitest-environment node
/** add-fly-hosting 2.3: fly.toml shape, and nothing secret in it or in the build context rules. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const web = join(__dirname, '..', '..');
const toml = readFileSync(join(web, 'fly.toml'), 'utf8');
const line = (re: RegExp) => toml.match(re)?.[1];

describe('fly.toml', () => {
  it('has the decided settings', () => {
    expect(line(/^app = "([^"]+)"/m)).toBe('cryoshield-web');
    expect(line(/^primary_region = "([^"]+)"/m)).toBe('sin');
    expect(line(/internal_port = (\d+)/)).toBe('8080');
    expect(line(/force_https = (\w+)/)).toBe('true');
    expect(line(/auto_stop_machines = "(\w+)"/)).toBe('stop');
    expect(line(/auto_start_machines = (\w+)/)).toBe('true');
    expect(line(/min_machines_running = (\d+)/)).toBe('1');
    expect(line(/path = "([^"]+)"/)).toBe('/healthz');
    expect(line(/dockerfile = "([^"]+)"/)).toBe('deploy/Dockerfile');
  });

  it('has no env, secrets, mounts, or secret-looking values', () => {
    expect(toml).not.toMatch(/^\s*\[(env|mounts)\]/m);
    expect(toml).not.toMatch(/VITE_|apikey|pim_|sp_[a-z]|secret\s*=|token\s*=|password/i);
  });

  it('.dockerignore whitelists only deploy/.build', () => {
    const ig = readFileSync(join(web, '.dockerignore'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
    expect(ig).toEqual(['*', '!deploy/.build/', '!deploy/.build/**']);
  });

  it('the Dockerfile pins Caddy by digest and runs as non-root', () => {
    const df = readFileSync(join(web, 'deploy', 'Dockerfile'), 'utf8');
    expect(df).toMatch(/^FROM caddy:[\w.-]+@sha256:[0-9a-f]{64}$/m);
    expect(df).toMatch(/^USER 65534:65534$/m);
    expect(df).not.toMatch(/^ARG /m);
  });
});

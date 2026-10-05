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
    expect(line(/auto_stop_machines = "(\w+)"/)).toBe('suspend'); // fly-scale-to-zero
    expect(line(/auto_start_machines = (\w+)/)).toBe('true');
    expect(line(/min_machines_running = (\d+)/)).toBe('0'); // fly-scale-to-zero
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

describe('fly.dev.toml (split-dev-and-release-deploys)', () => {
  const dev = readFileSync(join(web, 'fly.dev.toml'), 'utf8');
  const devLine = (re: RegExp) => dev.match(re)?.[1];

  it('is the development app with the same scale-to-zero, build and health check as production', () => {
    expect(devLine(/^app = "([^"]+)"/m)).toBe('cryoshield-web-dev');
    expect(devLine(/^primary_region = "([^"]+)"/m)).toBe('sin');
    expect(devLine(/auto_stop_machines = "(\w+)"/)).toBe('suspend');
    expect(devLine(/auto_start_machines = (\w+)/)).toBe('true');
    expect(devLine(/min_machines_running = (\d+)/)).toBe('0');
    for (const re of [/internal_port = (\d+)/, /force_https = (\w+)/, /path = "([^"]+)"/, /dockerfile = "([^"]+)"/]) {
      expect(devLine(re)).toBe(line(re));
    }
  });

  it('has no env, secrets, mounts, or secret-looking values', () => {
    expect(dev).not.toMatch(/^\s*\[(env|mounts)\]/m);
    expect(dev).not.toMatch(/VITE_|apikey|pim_|sp_[a-z]|secret\s*=|token\s*=|password/i);
  });
});

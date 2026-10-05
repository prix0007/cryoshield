// @vitest-environment node
/**
 * add-fly-hosting 2.3, split-dev-and-release-deploys: fly.toml and fly.dev.toml shape, and nothing secret in them or in
 * the build context rules. The TOML is parsed per section (ECC review L4), so a key is only accepted in its own table.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const web = join(__dirname, '..', '..');

/** Minimal TOML reader for these flat configs: `[table]` / `[[array-table]]` headers and `key = value` lines.
 * Keys become "<table>.<key>"; a repeated key or any line it does not understand fails the test. */
function parseToml(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let table = '';
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^([^"#]*("[^"]*"[^"#]*)*)#.*$/, '$1').trim();
    if (!line) continue;
    const header = /^\[\[?([A-Za-z0-9_.]+)\]\]?$/.exec(line);
    if (header) {
      table = header[1]!;
      continue;
    }
    const kv = /^([A-Za-z0-9_]+)\s*=\s*(.+)$/.exec(line);
    if (!kv) throw new Error(`unexpected TOML line: ${raw}`);
    const key = table ? `${table}.${kv[1]}` : kv[1]!;
    if (key in out) throw new Error(`duplicate key ${key}`);
    out[key] = kv[2]!.replace(/^"(.*)"$/, '$1');
  }
  return out;
}

const text = readFileSync(join(web, 'fly.toml'), 'utf8');
const prod = parseToml(text);
const devText = readFileSync(join(web, 'fly.dev.toml'), 'utf8');
const dev = parseToml(devText);
const SHARED = [
  'build.dockerfile',
  'http_service.internal_port',
  'http_service.force_https',
  'http_service.auto_stop_machines',
  'http_service.auto_start_machines',
  'http_service.min_machines_running',
  'http_service.checks.path',
  'http_service.checks.method',
  'vm.size',
  'vm.memory',
];

describe('fly.toml', () => {
  it('has the decided settings, each in its own table', () => {
    expect(prod.app).toBe('cryoshield-web');
    expect(prod.primary_region).toBe('sin');
    expect(prod['http_service.internal_port']).toBe('8080');
    expect(prod['http_service.force_https']).toBe('true');
    expect(prod['http_service.auto_stop_machines']).toBe('suspend'); // fly-scale-to-zero
    expect(prod['http_service.auto_start_machines']).toBe('true');
    expect(prod['http_service.min_machines_running']).toBe('0'); // fly-scale-to-zero
    expect(prod['http_service.checks.path']).toBe('/healthz');
    expect(prod['build.dockerfile']).toBe('deploy/Dockerfile');
  });

  it('the parser rejects keys outside their table and repeated keys', () => {
    expect(parseToml('[build]\npath = "/healthz"\n')['http_service.checks.path']).toBeUndefined();
    expect(() => parseToml('app = "a"\napp = "b"\n')).toThrow(/duplicate/);
  });

  it('has no env, secrets, mounts, or secret-looking values', () => {
    expect(text).not.toMatch(/^\s*\[(env|mounts)\]/m);
    expect(text).not.toMatch(/VITE_|apikey|pim_|sp_[a-z]|secret\s*=|token\s*=|password/i);
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
  it('is the development app with the same scale-to-zero, build, health check and VM as production', () => {
    expect(dev.app).toBe('cryoshield-web-dev');
    expect(dev.primary_region).toBe('sin');
    for (const k of SHARED) expect(dev[k], k).toBe(prod[k]);
    // nothing else differs but the app
    expect(Object.keys(dev).sort()).toEqual(Object.keys(prod).sort());
  });

  it('has no env, secrets, mounts, or secret-looking values', () => {
    expect(devText).not.toMatch(/^\s*\[(env|mounts)\]/m);
    expect(devText).not.toMatch(/VITE_|apikey|pim_|sp_[a-z]|secret\s*=|token\s*=|password/i);
  });
});

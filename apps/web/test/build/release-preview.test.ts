// @vitest-environment node
/**
 * footer-release-version D7: the dev and preview servers answer /release.json like the development site (the
 * checked-out commit, release null), uncached, and leave every other path alone.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { devReleaseIdentity, releaseHandler, releasePreviewPlugin } from '../../vite-plugins/release-preview';

const ROOT = join(__dirname, '..', '..');

function fakeRes() {
  const headers: Record<string, string> = {};
  const res = { statusCode: 0, body: '', setHeader: (k: string, v: string) => void (headers[k.toLowerCase()] = v), end: (b: string) => void (res.body = b) };
  return { res, headers };
}

describe('devReleaseIdentity', () => {
  it('names the checked-out commit with release null', () => {
    const head = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    expect(devReleaseIdentity(ROOT)).toEqual({ name: 'cryoshield-web', commit: head, release: null });
  });

  it('falls back to forty zeros outside a git checkout', () => {
    expect(devReleaseIdentity(mkdtempSync(join(tmpdir(), 'cs-nogit-')))).toEqual({ name: 'cryoshield-web', commit: '0'.repeat(40), release: null });
  });
});

describe('releaseHandler', () => {
  const identity = { name: 'cryoshield-web' as const, commit: 'a'.repeat(40), release: null };

  it.each(['/release.json', '/release.json?x=1'])('serves %s as uncached JSON', (url) => {
    const { res, headers } = fakeRes();
    const next = vi.fn();
    releaseHandler(identity)({ url } as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(headers['content-type']).toMatch(/^application\/json/);
    expect(headers['cache-control']).toBe('no-store');
    expect(JSON.parse(res.body)).toEqual(identity);
  });

  it.each(['/', '/app/', '/release.json/x', '/assets/release.json', '/release.jsonp'])('passes %s through', (url) => {
    const { res } = fakeRes();
    const next = vi.fn();
    releaseHandler(identity)({ url } as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(0);
  });

  it('is installed on both the dev and the preview server, and nothing else (the build never ships the file)', () => {
    const p = releasePreviewPlugin(ROOT);
    expect(Object.keys(p).sort()).toEqual(['configurePreviewServer', 'configureServer', 'name']);
  });
});

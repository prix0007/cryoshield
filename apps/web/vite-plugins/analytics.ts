/**
 * Build-time side of the landing analytics (add-privacy-preserving-analytics D3/D4). Never imported by app code: the
 * token, beacon URL and integrity only ever reach the landing HTML (inside an inert <template>) and the landing CSP.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ANALYTICS_CONNECT = 'https://cloudflareinsights.com';

export interface BeaconLock {
  mode: 'cf-hosted';
  url: string;
  sha384: string;
}
export interface AnalyticsBuild {
  token: string;
  host: string;
  lock: BeaconLock;
}

const TOKEN_RE = /^[0-9a-f]{32}$/;

/** Enabled only for production and the dedicated E2E analytics mode, and only with a valid token. */
export function analyticsFor(env: Record<string, string | undefined>, mode: string, root: string, host: string): AnalyticsBuild | null {
  const token = env.VITE_CF_BEACON_TOKEN?.trim();
  if (!token) return null;
  if (!TOKEN_RE.test(token)) throw new Error('VITE_CF_BEACON_TOKEN must be the 32-hex Cloudflare Web Analytics site token');
  if (mode !== 'production' && mode !== 'e2e-analytics') return null; // dev and E2E builds never load the beacon
  const lockPath = mode === 'e2e-analytics' ? join(root, 'e2e', 'fixtures', 'beacon.lock.e2e.json') : join(root, 'analytics', 'beacon.lock.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as BeaconLock;
  if (lock.mode !== 'cf-hosted' || !/^https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js$/.test(lock.url)) throw new Error(`${lockPath}: unexpected beacon url/mode`);
  if (!/^sha384-[A-Za-z0-9+/]{64}$/.test(lock.sha384)) throw new Error(`${lockPath}: sha384 must be an SRI sha384 value`);
  return { token, host, lock };
}

/** Landing CSP additions: the exact beacon URL in script-src (D4b) and the report origin in connect-src. */
export const landingCspExtras = (a: AnalyticsBuild) => ({ script: [a.lock.url], connect: [ANALYTICS_CONNECT] });

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The inert, reviewed beacon element; src/landing/analytics.ts clones it only when GPC/DNT/host allow. */
export function beaconTemplate(a: AnalyticsBuild): string {
  const cfg = JSON.stringify({ token: a.token, spa: false });
  return `<template id="cf-beacon" data-host="${attr(a.host)}"><script defer src="${attr(a.lock.url)}" integrity="${attr(a.lock.sha384)}" crossorigin="anonymous" data-cf-beacon="${attr(cfg)}"></script></template>`;
}

/** SRI value for local bytes (tests and the drift check). */
export const sri384 = (bytes: Uint8Array) => `sha384-${createHash('sha384').update(bytes).digest('base64')}`;

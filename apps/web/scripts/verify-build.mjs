#!/usr/bin/env node
/**
 * Task 9.2 build checks:
 *   - two clean builds (same mode) produce byte-identical dist/ (reproducible);
 *   - no source maps, no console calls, no E2E-only code (prf shim, dev bundler, test controls);
 *   - index.html carries the strict CSP meta tag; _headers carries frame-ancestors.
 *   - the same checks on a PRODUCTION-mode build (https endpoints from a production-like env), which must also
 *     contain no loopback endpoints from .env.development / .env.e2e.
 *   - --real-env (deploy, add-fly-hosting 3.1): ONLY two production builds with the real apps/web/.env, identical,
 *     the same bundle checks, no loopback endpoints, and (with --expect-host) the bundle's RP ID equals the host.
 *     Leaves the verified dist/ in place for deploy/gen-context.mjs.
 * Usage: node scripts/verify-build.mjs [--mode e2e] | --real-env [--expect-host cryoshield.app]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const modeIdx = process.argv.indexOf('--mode');
const mode = modeIdx > 0 ? process.argv[modeIdx + 1] : 'e2e';
const dist = join(root, 'dist');
const realEnv = process.argv.includes('--real-env');
const hostIdx = process.argv.indexOf('--expect-host');
const expectHost = hostIdx > 0 ? process.argv[hostIdx + 1] : undefined;

const PROD_ENV = {
  VITE_CHAIN_ID: process.env.VERIFY_CHAIN_ID ?? '31337', // any chain with a contracts/deployments/<id>.json
  VITE_RPC_URL: 'https://rpc.verify.invalid',
  VITE_BUNDLER_URL: 'https://bundler.verify.invalid/rpc?apikey=pim_public',
  VITE_SPONSORSHIP_POLICY_ID: 'sp_verify',
  VITE_TURBO_UPLOAD_URL: 'https://upload.ardrive.io',
  VITE_ARWEAVE_GATEWAY_URL: 'https://arweave.net',
  VITE_RP_ID: 'cryoshield.app',
  VITE_RP_NAME: 'CryoShield',
};

function build(buildMode = mode, extraEnv = {}) {
  rmSync(dist, { recursive: true, force: true });
  try {
    execFileSync('pnpm', ['exec', 'vite', 'build', '--mode', buildMode], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, ...extraEnv, NODE_ENV: 'production' },
    });
  } catch (e) {
    const lines = String(e.stderr ?? e.message).split('\n');
    const msg = lines.find((l) => /deployment|ConfigError|Missing required/.test(l)) ?? lines.find((l) => /Error/.test(l)) ?? 'vite build failed';
    fail(`${buildMode} build failed: ${msg.trim()}`);
  }
  return hashTree(dist);
}

function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

function hashTree(dir) {
  const h = createHash('sha256');
  for (const f of files(dir).sort()) h.update(f.slice(dir.length)).update(readFileSync(f));
  return h.digest('hex');
}

const fail = (m) => {
  console.error(`FAIL ${m}`);
  process.exit(1);
};

function checkBundle(label) {
const all = files(dist);
if (all.some((f) => f.endsWith('.map'))) fail(`[${label}] source maps present`);
const js = all.filter((f) => f.endsWith('.js')).map((f) => readFileSync(f, 'utf8')).join('\n');
for (const banned of ['console.', 'prf-shim', 'cryoshield_setPolicy', 'cryoshield_stats', 'E2EPaymaster', '__recordPrf', 'jsxDEV', '/Users/', '/home/']) {
  if (js.includes(banned)) fail(`bundle contains "${banned}" (dev build or local path leak?)`);
}
console.log(`ok   [${label}] no source maps, console calls, or E2E-only code in the bundle`);

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1];
if (!csp) fail('no CSP meta tag');
for (const d of ["default-src 'none'", "script-src 'self'", "require-trusted-types-for 'script'", "base-uri 'none'", "form-action 'none'"]) {
  if (!csp.includes(d)) fail(`CSP missing ${d}`);
}
if (/unsafe-inline|unsafe-eval/.test(csp)) fail('CSP allows unsafe-*');
if (/<script(?![^>]*\bsrc=)[^>]*>/.test(html)) fail('inline script in index.html');
if (!readFileSync(join(dist, '_headers'), 'utf8').includes("frame-ancestors 'none'")) fail('_headers lacks frame-ancestors');
console.log(`ok   [${label}] strict CSP in index.html and _headers`);
return { js, html };
}

if (!realEnv) {
  const a = build();
  const b = build();
  if (a !== b) fail(`builds differ: ${a} != ${b}`);
  console.log(`ok   reproducible build ${a}`);
  checkBundle(mode);
}

// Production-mode build: same checks, plus no loopback endpoints and the production origins in the CSP.
const prodEnv = realEnv ? {} : PROD_ENV;
const p1 = build('production', prodEnv);
const p2 = build('production', prodEnv);
if (p1 !== p2) fail(`production builds differ: ${p1} != ${p2}`);
console.log(`ok   reproducible production build ${p1}`);
const prod = checkBundle('production');
for (const loop of ['127.0.0.1', 'localhost:', 'sp_e2e_local']) {
  if (prod.js.includes(loop) || prod.html.includes(loop)) fail(`production build contains "${loop}"`);
}
if (!realEnv && (!prod.html.includes('https://rpc.verify.invalid') || !prod.html.includes('https://bundler.verify.invalid'))) fail('production CSP lacks configured origins');
if (expectHost) {
  const m = prod.js.match(/rpId:[`"']([^`"']+)[`"']/);
  if (!m) fail('could not find the RP ID in the bundle');
  if (m[1] !== expectHost) fail(`bundle RP ID ${m[1]} != deploy host ${expectHost}`);
  console.log(`ok   [production] bundle RP ID == ${expectHost}`);
}
console.log('ok   [production] no loopback/E2E endpoints; CSP lists the configured origins');
console.log('PASS verify-build');

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
 *   - every HTML page (landing /, app /app/) carries the same strict CSP (redesign-landing-and-app-ui D1/D8);
 *   - the landing page's JS budget (D4): initial <= 6 KB gzip, each lazy chunk <= 10 KB, whole graph <= 16 KB,
 *     and no React / viem / vault code in the landing graph. VERIFY_LANDING_BUDGET_SCALE scales the budgets (tests).
 * Usage: node scripts/verify-build.mjs [--mode e2e] | --real-env [--expect-host cryoshield.app]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

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

const pages = all.filter((f) => f.endsWith('.html'));
if (!pages.some((f) => relative(dist, f) === 'index.html') || !pages.some((f) => relative(dist, f) === join('app', 'index.html'))) {
  fail(`[${label}] expected index.html and app/index.html, got ${pages.map((f) => relative(dist, f)).join(', ')}`);
}
let firstCsp;
for (const page of pages) {
  const name = relative(dist, page);
  const h = readFileSync(page, 'utf8');
  const metas = [...h.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/g)];
  if (metas.length !== 1) fail(`[${label}] ${name}: expected exactly one CSP meta tag`);
  const csp = metas[0][1];
  for (const d of ["default-src 'none'", "script-src 'self'", "require-trusted-types-for 'script'", "trusted-types 'none'", "base-uri 'none'", "form-action 'none'"]) {
    if (!csp.includes(d)) fail(`${name}: CSP missing ${d}`);
  }
  if (/unsafe-inline|unsafe-eval|wasm-unsafe-eval/.test(csp)) fail(`${name}: CSP allows unsafe-*`);
  if (firstCsp !== undefined && csp !== firstCsp) fail(`[${label}] ${name}: CSP differs from the other pages`);
  firstCsp = csp;
  if (/<script(?![^>]*\bsrc=)[^>]*>/.test(h)) fail(`inline script in ${name}`);
  if (/\sstyle=|<style[\s>]/i.test(h)) fail(`inline style in ${name}`);
  if (/(src|href)="(https?:)?\/\//.test(h.replace(/<a\s[^>]*>/g, ''))) fail(`${name} loads a resource from another origin`);
}
const html = pages.map((f) => readFileSync(f, 'utf8')).join('\n');
if (!readFileSync(join(dist, '_headers'), 'utf8').includes("frame-ancestors 'none'")) fail('_headers lacks frame-ancestors');
console.log(`ok   [${label}] identical strict CSP in ${pages.length} pages and _headers`);
landingBudget(label);
return { js, html };
}


/** Landing JS budget (spec landing-page "Landing performance budget"; design D4). Sizes are gzip -9 bytes. */
const KB = 1024;
const scale = Number(process.env.VERIFY_LANDING_BUDGET_SCALE ?? '1');
const BUDGET = { initial: 6 * KB * scale, lazyChunk: 10 * KB * scale, total: 16 * KB * scale };
function landingBudget(label) {
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const entries = [...html.matchAll(/<(?:script|link rel="modulepreload")[^>]*\b(?:src|href)="\/([^"]+\.js)"/g)].map((m) => m[1]);
  const gz = (f) => gzipSync(readFileSync(join(dist, f)), { level: 9 }).length;
  const edges = (f) => {
    const code = readFileSync(join(dist, f), 'utf8');
    const dir = f.slice(0, f.lastIndexOf('/') + 1);
    const norm = (p) => (p.startsWith('./') ? dir + p.slice(2) : p.replace(/^\//, ''));
    const stat = [...code.matchAll(/(?:^|[;}\s])(?:import|export)\s*(?:[\w$*{}\s,]*?from\s*)?["'`](\.\/[^"'`]+\.js)["'`]/g)].map((m) => norm(m[1]));
    const dyn = [...code.matchAll(/import\(\s*["'`](\.\/[^"'`]+\.js)["'`]\s*\)/g)].map((m) => norm(m[1]));
    return { stat, dyn };
  };
  const initial = new Set();
  const lazy = new Set();
  const walk = (f, set) => {
    if (initial.has(f) || set.has(f)) return;
    set.add(f);
    const { stat, dyn } = edges(f);
    stat.forEach((g) => walk(g, set));
    dyn.forEach((g) => walk(g, lazy));
  };
  entries.forEach((e) => walk(e, initial));
  for (const f of initial) lazy.delete(f);
  const sum = (set) => [...set].reduce((n, f) => n + gz(f), 0);
  const initialBytes = sum(initial);
  const totalBytes = initialBytes + sum(lazy);
  const all = [...initial, ...lazy];
  const code = all.map((f) => readFileSync(join(dist, f), 'utf8')).join('\n');
  for (const marker of ['react.transitional.element', 'react.element', 'viem@', 'rpId:', 'createRoot', 'VaultRegistry']) {
    if (code.includes(marker)) fail(`[${label}] landing graph contains "${marker}" (React/viem/vault code on the landing page)`);
  }
  const fmt = (n) => `${(n / KB).toFixed(2)} KB`;
  const detail = all.map((f) => `${f} ${fmt(gz(f))}${initial.has(f) ? '' : ' (lazy)'}`).join(', ');
  console.log(`info [${label}] landing JS gzip: initial ${fmt(initialBytes)} / ${fmt(BUDGET.initial)}, total ${fmt(totalBytes)} / ${fmt(BUDGET.total)} [${detail || 'no JS'}]`);
  if (initialBytes > BUDGET.initial) fail(`[${label}] landing initial JS ${fmt(initialBytes)} > budget ${fmt(BUDGET.initial)}`);
  for (const f of lazy) if (gz(f) > BUDGET.lazyChunk) fail(`[${label}] lazy chunk ${f} ${fmt(gz(f))} > budget ${fmt(BUDGET.lazyChunk)}`);
  if (totalBytes > BUDGET.total) fail(`[${label}] landing JS total ${fmt(totalBytes)} > budget ${fmt(BUDGET.total)}`);
  console.log(`ok   [${label}] landing JS within budget; no React/viem/vault code`);
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

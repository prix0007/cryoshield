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
 *   - the landing page's JS budget (cinematic-landing D3): initial <= 15 KB gzip, each lazy chunk <= 40 KB, graph <= 120 KB,
 *     and no React / viem / vault code in the landing graph. VERIFY_LANDING_BUDGET_SCALE scales the budgets (tests).
 * Usage: node scripts/verify-build.mjs [--mode e2e] | --real-env [--expect-host cryoshield.app]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { checkOrigins } from './origins-check.mjs';
import { checkNoPlaceholders, unlistedStorageApis } from './legal-check.mjs';
import { checkSecurityTxt } from './securitytxt-check.mjs';
import { analyticsLeaks, landingCspDiff, policyDrift } from './analytics-check.mjs';

const root = new URL('..', import.meta.url).pathname;
const storageInventory = JSON.parse(readFileSync(join(root, 'legal', 'storage-inventory.json'), 'utf8'));
const originsInventory = JSON.parse(readFileSync(join(root, '..', '..', 'docs', 'compliance', 'origins.json'), 'utf8'));
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
  // Landing analytics on, so the per-route CSP, the beacon pin and the app/legal confinement are verified.
  VITE_CF_BEACON_TOKEN: 'ab'.repeat(16),
};
const beaconLock = JSON.parse(readFileSync(join(root, 'analytics', 'beacon.lock.json'), 'utf8'));

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
const cspOf = (rel) => readFileSync(join(dist, rel), 'utf8').match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1] ?? '';
const appCsp = cspOf(join('app', 'index.html'));
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
  // add-privacy-preserving-analytics D3: every page but the landing document carries the identical app CSP; the
  // landing CSP may add only the analytics beacon and its report origin.
  if (name === 'index.html') {
    const diff = landingCspDiff(appCsp, csp);
    if (diff.length) fail(`[${label}] landing CSP differs from the app CSP by more than the analytics sources: ${diff.join('; ')}`);
  } else if (csp !== appCsp) fail(`[${label}] ${name}: CSP differs from the app CSP`);
  // add-privacy-and-compliance 2.2: every contacted origin is in the data-flow inventory.
  const o = checkOrigins(csp, originsInventory);
  if (o.missing.length) fail(`[${label}] ${name}: origin(s) not in docs/compliance/origins.json: ${o.missing.join(', ')}`);
  if (name === 'index.html') for (const l of o.listed) console.log(`info [${label}] origin ${l.origin} -> inventory row ${l.row} (${l.role})`);
  if (/<script(?![^>]*\bsrc=)[^>]*>/.test(h)) fail(`inline script in ${name}`);
  if (/\sstyle=|<style[\s>]/i.test(h)) fail(`inline style in ${name}`);
  // Only the integrity-pinned beacon, inert in its <template> on the landing page, may name another origin.
  let rest = h.replace(/<a\s[^>]*>/g, '');
  if (name === 'index.html') {
    const tpl = rest.match(/<template id="cf-beacon" data-host="[^"]+"><script defer src="([^"]+)" integrity="([^"]+)" crossorigin="anonymous" data-cf-beacon="[^"]+"><\/script><\/template>/);
    if (tpl) {
      if (tpl[1] !== beaconLock.url && label === 'production') fail(`[${label}] beacon src ${tpl[1]} != analytics/beacon.lock.json url`);
      if (tpl[2] !== beaconLock.sha384 && label === 'production') fail(`[${label}] beacon integrity ${tpl[2]} != analytics/beacon.lock.json sha384`);
      rest = rest.replace(tpl[0], '');
    }
  }
  if (/(src|href)="(https?:)?\/\//.test(rest)) fail(`${name} loads a resource from another origin`);
}
// add-privacy-preserving-analytics 4.2: no file of the app or the legal pages (HTML + reachable JS) mentions analytics.
const token = label === 'production' && !realEnv ? PROD_ENV.VITE_CF_BEACON_TOKEN : undefined;
const confined = {};
for (const rel of [join('app', 'index.html'), join('privacy', 'index.html'), join('terms', 'index.html'), join('cookies', 'index.html'), join('architecture', 'index.html')]) {
  // The legal pages must NAME the analytics in their prose (5.1); everything else on them must not reference it.
  confined[rel] = readFileSync(join(dist, rel), 'utf8').replace(/<article class="(legal-doc|arch-doc)">[\s\S]*?<\/article>/, '');
  for (const f of graphOf(rel)) confined[f] = readFileSync(join(dist, f), 'utf8');
}
const leaks = analyticsLeaks(confined, token);
if (leaks.length) fail(`[${label}] analytics outside the landing document: ${leaks.join('; ')}`);
const landingHtml = readFileSync(join(dist, 'index.html'), 'utf8');
const analyticsOn = landingHtml.includes('id="cf-beacon"');
if (label === 'production' && !realEnv && !analyticsOn) fail(`[${label}] expected the beacon template on the landing page (token set)`);
if (analyticsOn) {
  // 5.1 policy drift: the shipped analytics must be named on /privacy and /cookies.
  const drift = policyDrift({ 'privacy/index.html': readFileSync(join(dist, 'privacy', 'index.html'), 'utf8'), 'cookies/index.html': readFileSync(join(dist, 'cookies', 'index.html'), 'utf8') });
  if (drift.length) fail(`[${label}] ${drift.join('; ')}`);
}
console.log(`ok   [${label}] analytics confined to the landing document${analyticsOn ? ' (beacon pinned to the lock; disclosed on /privacy and /cookies)' : ' (no beacon in this build)'}`);
const html = pages.map((f) => readFileSync(f, 'utf8')).join('\n');
// add-privacy-and-compliance 3.2: the legal pages exist.
for (const p of ['privacy', 'terms', 'cookies', 'architecture']) {
  if (!all.includes(join(dist, p, 'index.html'))) fail(`[${label}] missing legal page ${p}/index.html`);
}
// adopt-oss-project-defaults D3: no placeholder token and no @cryoshield.app address in any shipped HTML/text file.
const leftovers = all.filter((f) => /\.(html|txt)$/.test(f)).flatMap((f) => checkNoPlaceholders(readFileSync(f, 'utf8'), relative(dist, f)));
if (leftovers.length) fail(`[${label}] ${leftovers.join('; ')}`);
// Device-storage inventory (spec legal-pages): no shipped bundle may reference a storage API not listed.
const unlisted = unlistedStorageApis(js, storageInventory);
if (unlisted.length) fail(`[${label}] bundle uses ${unlisted.join(', ')}, which legal/storage-inventory.json (the /cookies table) does not list`);
console.log(`ok   [${label}] legal pages present; no unlisted device-storage API in any bundle`);
// add-privacy-and-compliance 5.1: RFC 9116 security.txt, Expires in the future and <= 365 days ahead.
const stxt = join(dist, '.well-known', 'security.txt');
if (!all.includes(stxt)) fail(`[${label}] missing .well-known/security.txt`);
const stxtErrors = checkSecurityTxt(readFileSync(stxt, 'utf8'));
if (stxtErrors.length) fail(`[${label}] ${stxtErrors.join('; ')}`);
console.log(`ok   [${label}] security.txt valid (Expires within 365 days)`);
if (!readFileSync(join(dist, '_headers'), 'utf8').includes("frame-ancestors 'none'")) fail('_headers lacks frame-ancestors');
console.log(`ok   [${label}] strict CSP in ${pages.length} pages (app CSP everywhere but the landing document) and _headers`);
landingBudget(label);
appBudget(label);
return { js, html };
}


/** Landing JS budget (spec landing-page "Landing performance budget"; design D4). Sizes are gzip -9 bytes. */
const KB = 1024;
const scale = Number(process.env.VERIFY_LANDING_BUDGET_SCALE ?? '1');
// cinematic-landing D3: raised for the scroll scenes (founder brief); the measured total is far below the ceiling.
const BUDGET = { initial: 15 * KB * scale, lazyChunk: 40 * KB * scale, total: 120 * KB * scale };
/** Every JS file reachable (static + dynamic imports) from an HTML page's entry scripts and modulepreloads. */
function graphOf(htmlRel) {
  const html = readFileSync(join(dist, htmlRel), 'utf8');
  const entries = [...html.matchAll(/<(?:script|link rel="modulepreload")[^>]*\b(?:src|href)="\/([^"]+\.js)"/g)].map((m) => m[1]);
  const seen = new Set();
  const visit = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    const code = readFileSync(join(dist, f), 'utf8');
    const dir = f.slice(0, f.lastIndexOf('/') + 1);
    for (const m of code.matchAll(/["'`](\.\/[^"'`]+\.js)["'`]/g)) visit(dir + m[1].slice(2));
  };
  entries.forEach(visit);
  return [...seen];
}

/** A page's JS split into the initial graph (entries + static imports) and lazily imported chunks. */
function splitGraph(htmlRel) {
  const html = readFileSync(join(dist, htmlRel), 'utf8');
  const entries = [...html.matchAll(/<(?:script|link rel="modulepreload")[^>]*\b(?:src|href)="\/([^"]+\.js)"/g)].map((m) => m[1]);
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
  return { initial, lazy };
}
const gz = (f) => gzipSync(readFileSync(join(dist, f)), { level: 9 }).length;

/**
 * /app initial JS budget (app-motion-ux, guardrail c): Motion for React may add at most 20 KB gzip to the vault app's
 * initial JS. Baseline measured on origin/main 32ae235 (pre-motion) in both e2e and production modes.
 */
const APP_BASELINE = 194_689;
const APP_ALLOWANCE = 20 * KB;
function appBudget(label) {
  const { initial, lazy } = splitGraph(join('app', 'index.html'));
  const bytes = [...initial].reduce((n, f) => n + gz(f), 0);
  const lazyBytes = [...lazy].reduce((n, f) => n + gz(f), 0);
  const delta = bytes - APP_BASELINE;
  console.log(
    `info [${label}] /app initial JS gzip: ${bytes} B (baseline ${APP_BASELINE} B, ${delta >= 0 ? '+' : ''}${delta} B; allowance +${APP_ALLOWANCE} B); lazy ${lazyBytes} B`,
  );
  if (bytes > APP_BASELINE + APP_ALLOWANCE) fail(`[${label}] /app initial JS ${bytes} B exceeds baseline + 20 KB (${APP_BASELINE + APP_ALLOWANCE} B)`);
  // The landing bundle stays unchanged: /app's Motion for React never shares a chunk with the landing page
  // (vite-plugins/app-motion-isolation.ts). Only Vite's tiny preload helper is common to both.
  const land = splitGraph('index.html');
  const landing = new Set([...land.initial, ...land.lazy]);
  const shared = [...initial, ...lazy].filter((f) => landing.has(f) && !/\/preload-helper-[\w-]+\.js$/.test(f));
  if (shared.length) fail(`[${label}] /app shares chunks with the landing page: ${shared.join(', ')}`);
  console.log(`ok   [${label}] /app initial JS within budget`);
}

function landingBudget(label) {
  const { initial, lazy } = splitGraph('index.html');
  const sum = (set) => [...set].reduce((n, f) => n + gz(f), 0);
  const initialBytes = sum(initial);
  const totalBytes = initialBytes + sum(lazy);
  const all = [...initial, ...lazy];
  const code = all.map((f) => readFileSync(join(dist, f), 'utf8')).join('\n');
  for (const marker of ['react.transitional.element', 'react.element', 'viem@', 'rpId:', 'createRoot', 'VaultRegistry']) {
    if (code.includes(marker)) fail(`[${label}] landing graph contains "${marker}" (React/viem/vault code on the landing page)`);
  }
  // CSP-hostile sinks never appear in landing code (cinematic-landing security review).
  for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'WebAssembly']) {
    if (code.includes(sink)) fail(`[${label}] landing graph contains "${sink}"`);
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

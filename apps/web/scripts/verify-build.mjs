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
import { checkOrigins, checkRpcDisclosed } from './origins-check.mjs';
import { checkNoPlaceholders, storageApiOutsideAllowedFiles, unlistedStorageApis } from './legal-check.mjs';
import { checkSecurityTxt } from './securitytxt-check.mjs';
import { analyticsLeaks, landingCspDiff, policyDrift } from './analytics-check.mjs';
import { donationViolations, validateDonation } from './donation-check.mjs';
import { connectSrcViolations, stripJsonLd } from './csp-check.mjs';

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
  // launch-op-mainnet 4.4: VERIFY_RPC_URL (e.g. https://mainnet.optimism.io with VERIFY_CHAIN_ID=10) checks the real
  // privacy disclosure of that RPC; the default .invalid fixture is exempt.
  VITE_RPC_URL: process.env.VERIFY_RPC_URL ?? 'https://rpc.verify.invalid',
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
  // improve-landing-seo D6: a JSON-LD data block (attribute-exact, JSON body without "<") is never executed; it is the
  // only inline <script> allowed, and only on the landing page.
  const ld = stripJsonLd(h);
  if (ld.errors.length) fail(`[${label}] ${name}: ${ld.errors.join('; ')}`);
  if (ld.blocks.length && name !== 'index.html') fail(`[${label}] ${name}: JSON-LD is only expected on the landing page`);
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(ld.html)) fail(`inline script in ${name}`);
  if (/\sstyle=|<style[\s>]/i.test(h)) fail(`inline style in ${name}`);
  // Only the integrity-pinned beacon, inert in its <template> on the landing page, may name another origin.
  // improve-landing-seo D7: the canonical link names the production URL; it is not a fetched resource.
  let rest = h.replace(/<a\s[^>]*>/g, '').replace(/<link rel="canonical" href="https:\/\/cryoshield\.app\/[a-z]*">/g, '');
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
for (const rel of [join('app', 'index.html'), join('privacy', 'index.html'), join('terms', 'index.html'), join('cookies', 'index.html'), join('architecture', 'index.html'), join('devices', 'index.html'), join('support', 'index.html')]) {
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
// launch-op-mainnet 4.4: the privacy sub-processor table names the configured RPC host.
if (label === 'production' && !realEnv) {
  const undisclosed = checkRpcDisclosed(readFileSync(join(dist, 'privacy', 'index.html'), 'utf8'), PROD_ENV.VITE_RPC_URL);
  if (undisclosed.length) fail(`[${label}] /privacy does not name the RPC host ${undisclosed.join(', ')} in its sub-processor table`);
  console.log(`ok   [${label}] /privacy names the RPC host of ${PROD_ENV.VITE_RPC_URL}`);
}
// add-privacy-and-compliance 3.2: the legal pages exist.
for (const p of ['privacy', 'terms', 'cookies', 'architecture', 'devices', 'support']) {
  if (!all.includes(join(dist, p, 'index.html'))) fail(`[${label}] missing legal page ${p}/index.html`);
}
// add-donation: anti-swap. The donation address comes only from config/donation.json, and no other address or payment
// URI appears in a donation context.
let donation;
try {
  donation = validateDonation(JSON.parse(readFileSync(join(root, '..', '..', 'config', 'donation.json'), 'utf8')));
} catch (e) {
  fail(`[${label}] config/donation.json: ${e.message}`);
}
const shipped = Object.fromEntries(all.filter((f) => /\.(html|js|css|svg)$/.test(f)).map((f) => [relative(dist, f), readFileSync(f, 'utf8')]));
const swaps = donationViolations(shipped, donation);
if (swaps.length) fail(`[${label}] donation address check: ${swaps.join('; ')}`);
if (/window\.ethereum|ethereum\.request\(/.test(js)) fail(`[${label}] the bundle calls an injected wallet (window.ethereum); donations must not`);
console.log(`ok   [${label}] donation address ${donation.address} (chain ${donation.chainId}) is the only one in donation contexts`);
// adopt-oss-project-defaults D3: no placeholder token and no @cryoshield.app address in any shipped HTML/text file.
const leftovers = all.filter((f) => /\.(html|txt)$/.test(f)).flatMap((f) => checkNoPlaceholders(readFileSync(f, 'utf8'), relative(dist, f)));
if (leftovers.length) fail(`[${label}] ${leftovers.join('; ')}`);
// Device-storage inventory (spec legal-pages): no shipped bundle may reference a storage API not listed.
const unlisted = unlistedStorageApis(js, storageInventory);
if (unlisted.length) fail(`[${label}] bundle uses ${unlisted.join(', ')}, which legal/storage-inventory.json (the /cookies table) does not list`);
// add-theme-switch D1/D5: every page loads exactly one theme script, the same one, and only that referenced asset may
// use a listed storage API (localStorage); not any other file, not even a stray theme-named one.
const themeSrcs = new Set();
for (const page of pages) {
  const themeTags = [...readFileSync(page, 'utf8').matchAll(/<script src="\/(assets\/theme-[0-9a-f]{8}\.js)"><\/script>/g)];
  if (themeTags.length !== 1) fail(`[${label}] ${relative(dist, page)}: expected exactly one theme script, found ${themeTags.length}`);
  themeSrcs.add(themeTags[0][1]);
}
if (themeSrcs.size !== 1) fail(`[${label}] pages load different theme scripts: ${[...themeSrcs].join(', ')}`);
const jsFiles = Object.fromEntries(all.filter((f) => f.endsWith('.js')).map((f) => [relative(dist, f), readFileSync(f, 'utf8')]));
const misplaced = storageApiOutsideAllowedFiles(jsFiles, storageInventory, [...themeSrcs]);
if (misplaced.length) fail(`[${label}] ${misplaced.join('; ')}`);
console.log(`ok   [${label}] legal pages present; no unlisted device-storage API in any bundle; localStorage only in the theme script`);
// add-privacy-and-compliance 5.1: RFC 9116 security.txt, Expires in the future and <= 365 days ahead.
const stxt = join(dist, '.well-known', 'security.txt');
if (!all.includes(stxt)) fail(`[${label}] missing .well-known/security.txt`);
const stxtErrors = checkSecurityTxt(readFileSync(stxt, 'utf8'));
if (stxtErrors.length) fail(`[${label}] ${stxtErrors.join('; ')}`);
console.log(`ok   [${label}] security.txt valid (Expires within 365 days)`);
// improve-landing-seo D9/D10: crawl files for production; the app is noindex and never in the sitemap.
for (const f of ['robots.txt', 'sitemap.xml', 'og-image.png']) if (!all.includes(join(dist, f))) fail(`[${label}] missing ${f}`);
const robots = readFileSync(join(dist, 'robots.txt'), 'utf8');
if (!/^Disallow: \/app\/$/m.test(robots) || /^Disallow:\s*\/\s*$/m.test(robots) || !robots.includes('Sitemap: https://cryoshield.app/sitemap.xml')) {
  fail(`[${label}] robots.txt must disallow only /app/ and name the sitemap`);
}
if (readFileSync(join(dist, 'sitemap.xml'), 'utf8').includes('/app')) fail(`[${label}] sitemap.xml lists /app`);
if (!/<meta name="robots" content="noindex"/.test(readFileSync(join(dist, 'app', 'index.html'), 'utf8'))) fail(`[${label}] app/index.html is not noindex`);
console.log(`ok   [${label}] robots.txt, sitemap.xml and og-image.png present; /app/ noindex`);
// add-llms-txt: llms.txt present, starts with the H1, links every sitemap URL, never mentions /app/.
const llmsPath = join(dist, 'llms.txt');
if (!all.includes(llmsPath)) fail(`[${label}] missing llms.txt`);
const llms = readFileSync(llmsPath, 'utf8');
if (!llms.startsWith('# CryoShield\n')) fail(`[${label}] llms.txt must start with "# CryoShield"`);
if (llms.includes('/app')) fail(`[${label}] llms.txt mentions /app`);
for (const [, loc] of readFileSync(join(dist, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)) {
  if (!llms.includes(`](${loc})`)) fail(`[${label}] llms.txt does not link ${loc}`);
}
console.log(`ok   [${label}] llms.txt present and links every public page`);
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
// harden-gas-sponsorship (2026-10-06): +2 KB for non-Motion feature code (VaultRegistry v2 paged reads, v1/v2
// authority, the CryoShield wallet wrapper). Measured gzip: main 214,644 B (+19,955 B over the pre-motion baseline);
// this change 215,698 B (+1,054 B net, about +1.5 KB before trimming the inlined v1 ABI), rounded up to 2 KB. The
// +20 KB Motion allowance is unchanged.
// harden-gas-sponsorship 5.5 (2026-10-08): the write stack (viem account abstraction, the Pimlico client, the wallet
// wrapper, the write operations) is now a lazy chunk loaded on the first save (src/account/lazy.ts). Measured gzip
// before 216,554 B (e2e) / 216,559 B (production), after 200,242 B / 200,239 B: -16,312 B. The +2 KB above is removed
// and the baseline lowered by a further 12 KB (whole KB, below the saving, about 2.6 KB of headroom left) so the saving
// can't be silently spent: 194,689 - 12 KB = 182,401 B.
// vault-list-labels-archive (2026-10-08, ECC review of feat/vlla-web): +1 KB, deliberately. Measured gzip: main 200,311 B
// (2da09c9) -> 202,980 B (+2,669 B), all of it in the initial chunk on purpose: the payload v2 codec (the decoder must be
// there to open any vault, ~1 KB), the single vault-list owner in Shell with the unlock routing and Check another key,
// the vault name heading, Archived notice and Unarchive, the name field at create, the STALE check,
// the nonce pin at vault open (one raw eth_call, so unlocking still never fetches the write stack), and the retryable
// chunk fallbacks. The list, the dates, the Edit vault sheet and the name/archive/clear writes are a lazy chunk
// (VAULT_LIST_MARKERS below). Headroom without this: under 0 B; with it: about 0.9 KB.
// progress-feedback (2026-10-08, founder request): +1 KB, deliberately. Measured gzip: 08a36fa (vault-view-action-layout
// after review) e2e 203,870 B / production 203,881 B -> 204,703 B / 204,718 B (+833 B / +837 B), all initial on purpose:
// the one shared progress view (bar, step states, reassurance, live text) must render before the lazy write stack
// loads, plus the unlock phases (unlock, Reload, Check another key) and the delayed loaders. Headroom before: 35 B;
// after: 211 B.
// add-theme-switch (2026-10-08, founder request): +1 KB, deliberately. Measured gzip: 204,703 B / 204,718 B
// (e2e / production) -> 205,576 B / 205,592 B (+873 B / +874 B): the theme script every page loads before first paint
// (assets/theme-*.js, minified, about 600 B, including the theme-color sync) plus the app's Theme menu markup. It must
// be initial: it applies the saved theme before the first paint. Headroom before: 211 B; after: about 360 B.
// launch-op-mainnet 4.5/4.6 (2026-10-09): +1 KB, deliberately. Measured gzip: main a59a179 /app UI with this change's
// network table 205,595 B / 205,605 B (e2e / production) -> 206,461 B / 206,473 B (+866 B / +868 B), all initial on purpose: the status notice
// must show on every network before anything loads (the Unaudited notice and chip on OP Mainnet, the testnet banner
// elsewhere), the no-vault help for testnet-preview vaults sits in the unlock screen, and the launch-date helpers decide
// both. Headroom before: 358 B; after: about 516 B.
const APP_BASELINE = 194_689 - 12 * 1024 + 1024 + 1024 + 1024 + 1024;
const APP_ALLOWANCE = 20 * KB;
const WRITE_STACK_MARKERS = ['eth_sendUserOperation', 'pimlico_getUserOperationGasPrice', 'WalletConfigError'];
// vault-list-labels-archive 3.1 (design D5): the vault list, the Edit vault sheet, Archive and clear and the dates
// (chain/history.ts: the VaultCreated topic) are one lazy chunk. Strings that exist only there must never be initial.
const VAULT_LIST_MARKERS = ['Check another key', 'I understand old versions stay readable', '0xce97d1455c031e2d207f467953389573a1f639ea41eac2279614dea27b5e7322'];
function appBudget(label) {
  const { initial, lazy } = splitGraph(join('app', 'index.html'));
  const bytes = [...initial].reduce((n, f) => n + gz(f), 0);
  const lazyBytes = [...lazy].reduce((n, f) => n + gz(f), 0);
  const delta = bytes - APP_BASELINE;
  console.log(
    `info [${label}] /app initial JS gzip: ${bytes} B (baseline ${APP_BASELINE} B, ${delta >= 0 ? '+' : ''}${delta} B; allowance +${APP_ALLOWANCE} B); lazy ${lazyBytes} B`,
  );
  // harden-gas-sponsorship 5.5: the write stack is a lazy chunk. Strings that survive minification and exist only in it
  // (the bundler and Pimlico RPC method names, our wallet wrapper's error name) must be absent from the initial graph
  // and present in a lazily imported chunk.
  const read = (f) => readFileSync(join(dist, f), 'utf8');
  for (const marker of WRITE_STACK_MARKERS) {
    const early = [...initial].filter((f) => read(f).includes(marker));
    if (early.length) fail(`[${label}] write-stack marker "${marker}" is in the initial /app graph: ${early.join(', ')}`);
    if (![...lazy].some((f) => read(f).includes(marker))) fail(`[${label}] write-stack marker "${marker}" is in no lazy /app chunk`);
  }
  console.log(`ok   [${label}] the write stack is only in a lazy /app chunk (${WRITE_STACK_MARKERS.join(', ')})`);
  const menuChunks = new Set();
  for (const marker of VAULT_LIST_MARKERS) {
    const early = [...initial].filter((f) => read(f).includes(marker));
    if (early.length) fail(`[${label}] vault-list marker "${marker}" is in the initial /app graph: ${early.join(', ')}`);
    const where = [...lazy].filter((f) => read(f).includes(marker));
    if (!where.length) fail(`[${label}] vault-list marker "${marker}" is in no lazy /app chunk`);
    where.forEach((f) => menuChunks.add(f));
  }
  if (menuChunks.size !== 1) fail(`[${label}] the vault list is spread over ${menuChunks.size} chunks (expected one): ${[...menuChunks].join(', ')}`);
  console.log(`ok   [${label}] the vault list and its dates are one lazy /app chunk (${[...menuChunks][0]})`);
  if (bytes > APP_BASELINE + APP_ALLOWANCE) fail(`[${label}] /app initial JS ${bytes} B exceeds baseline + 20 KB (${APP_BASELINE + APP_ALLOWANCE} B)`);
  // The landing bundle stays unchanged: /app's Motion for React never shares a chunk with the landing page
  // (vite-plugins/app-motion-isolation.ts). Only Vite's tiny preload helper and the theme script (add-theme-switch D1,
  // a dependency-free classic script every page loads) are common to both.
  const land = splitGraph('index.html');
  const landing = new Set([...land.initial, ...land.lazy]);
  const shared = [...initial, ...lazy].filter((f) => landing.has(f) && !/\/preload-helper-[\w-]+\.js$/.test(f) && !/^assets\/theme-[0-9a-f]{8}\.js$/.test(f));
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
// harden-codeql-web-findings (CodeQL #8/#9): the app CSP's connect-src, parsed, must be EXACTLY 'self' + the configured
// origins + the app-only fast index (src/config/schema.ts), never a substring match on the HTML.
if (!realEnv) {
  const appMetaCsp = readFileSync(join(dist, 'app', 'index.html'), 'utf8').match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1];
  if (!appMetaCsp) fail('production app page has no CSP meta tag');
  const origins = ['VITE_RPC_URL', 'VITE_BUNDLER_URL', 'VITE_TURBO_UPLOAD_URL', 'VITE_ARWEAVE_GATEWAY_URL'].map((k) => new URL(PROD_ENV[k]).origin);
  const expected = ["'self'", ...new Set([...origins, 'https://turbo-gateway.com'])];
  const bad = connectSrcViolations(appMetaCsp, expected);
  if (bad.length) fail(`production app CSP: ${bad.join('; ')}`);
}
if (expectHost) {
  const m = prod.js.match(/rpId:[`"']([^`"']+)[`"']/);
  if (!m) fail('could not find the RP ID in the bundle');
  if (m[1] !== expectHost) fail(`bundle RP ID ${m[1]} != deploy host ${expectHost}`);
  console.log(`ok   [production] bundle RP ID == ${expectHost}`);
}
console.log("ok   [production] no loopback/E2E endpoints; app CSP connect-src is exactly 'self' + the configured origins (token match)");
console.log('PASS verify-build');

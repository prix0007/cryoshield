#!/usr/bin/env node
/**
 * add-privacy-preserving-analytics 4.7 (spec landing-analytics "Drift detected"): fetch Cloudflare's live
 * beacon.min.js and compare its SHA-384 with apps/web/analytics/beacon.lock.json. Read-only; never updates the lock.
 *   node apps/web/scripts/beacon-drift.mjs
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const lock = JSON.parse(readFileSync(new URL('../analytics/beacon.lock.json', import.meta.url), 'utf8'));
const res = await fetch(lock.url, { redirect: 'error' });
if (!res.ok) {
  console.error(`::error title=beacon drift::GET ${lock.url} -> ${res.status}`);
  process.exit(2);
}
const bytes = new Uint8Array(await res.arrayBuffer());
const live = `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
const etag = res.headers.get('etag') ?? 'none';
if (live !== lock.sha384) {
  console.error(
    [
      `::error title=beacon drift::Cloudflare's beacon changed. Browsers now refuse it (SRI), so landing analytics is off until a review.`,
      `  committed: ${lock.sha384} (${lock.version ?? 'unknown version'})`,
      `  live:      ${live} (ETag ${etag}, ${bytes.length} bytes)`,
      `  Review and bump: apps/web/analytics/README.md`,
    ].join('\n'),
  );
  process.exit(1);
}
console.log(`ok   beacon unchanged: ${live} (ETag ${etag}, ${bytes.length} bytes)`);

#!/usr/bin/env node
// Normalizes a committed GitHub ruleset / settings file and the live API object for diffing
// (OpenSpec change adopt-pr-workflow, design decision 2).
//
// The live object is projected onto the keys the committed file declares, so server-added metadata
// and defaults do not cause perpetual diffs. Live rules or array items that the committed file does
// not declare are kept in full, so they DO show up as a difference.
//
// CLI: node ruleset-normalize.mjs <committed.json> <live.json> <out-dir>
//      writes <out-dir>/committed.json and <out-dir>/live.json (canonical, pretty-printed).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Identity key for arrays of objects whose order is not meaningful.
const ITEM_KEYS = ['type', 'context', 'actor_id'];
const itemKey = (item) => {
  if (!isObj(item)) return undefined;
  const k = ITEM_KEYS.find((key) => key in item);
  return k === undefined ? undefined : `${k}=${item[k]}`;
};

export function projectOnto(live, committed) {
  if (isObj(committed)) {
    if (!isObj(live)) return live;
    const out = {};
    for (const key of Object.keys(committed)) {
      if (key in live) out[key] = projectOnto(live[key], committed[key]);
    }
    return out;
  }
  if (Array.isArray(committed)) {
    if (!Array.isArray(live)) return live;
    const shapes = new Map(committed.map((c) => [itemKey(c), c]));
    return live.map((item) => {
      const k = itemKey(item);
      // Matching declared item: project onto its shape. Undeclared item: keep in full.
      return k !== undefined && shapes.has(k) ? projectOnto(item, shapes.get(k)) : item;
    });
  }
  return live;
}

const sortValue = (v) => JSON.stringify(v);

export function canonical(value) {
  if (Array.isArray(value)) {
    return value.map(canonical).sort((a, b) => {
      const ka = itemKey(a) ?? sortValue(a);
      const kb = itemKey(b) ?? sortValue(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  }
  if (isObj(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  }
  return value;
}

const pretty = (v) => `${JSON.stringify(canonical(v), null, 2)}\n`;

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [committedPath, livePath, outDir] = process.argv.slice(2);
  if (!committedPath || !livePath || !outDir) {
    console.error('usage: ruleset-normalize.mjs <committed.json> <live.json> <out-dir>');
    process.exit(2);
  }
  const committed = JSON.parse(readFileSync(committedPath, 'utf8'));
  const live = JSON.parse(readFileSync(livePath, 'utf8'));
  writeFileSync(join(outDir, 'committed.json'), pretty(committed));
  writeFileSync(join(outDir, 'live.json'), pretty(projectOnto(live, committed)));
}

#!/usr/bin/env node
// Mainnet deployment-record gate (OpenSpec change add-privacy-and-compliance, task 7.6;
// spec privacy-compliance "Compliance records reviewed on a schedule", scenario "Mainnet gate").
//
// A pull request that ADDS a mainnet deployment record `contracts/deployments/<chainId>.json` fails unless:
//   1. the chain's launch record exists: docs/reviews/launch-<preset name>.md (launch-op-mainnet keeps it for chain 10),
//      where the preset name comes from config/chain-presets.json; and
//   2. docs/compliance/review-log.md has a `mainnet-gate` entry, naming a reviewer, dated within the previous
//      WINDOW_DAYS days (inclusive) and not in the future.
// "Mainnet" is fail-closed: every chain id that is not a local or testnet preset of contracts/script/deploy.sh counts
// (a parity test keeps NON_MAINNET_CHAIN_IDS equal to that table). An unknown chain id fails, because it has no preset
// and so no launch record path. Only added files are gated: later edits to a record already on main are not.
//
// CLI: node mainnet-gate.mjs <added-files.txt> [--root <repo root>] [--today YYYY-MM-DD]
//   added-files: NUL- or newline-separated paths (git -c core.quotePath=false diff -z --name-only --no-renames
//   --diff-filter=A BASE...HEAD). --today defaults to the current UTC date.
// Exit: 0 pass, 1 gate failed, 2 bad input.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const NON_MAINNET_CHAIN_IDS = new Set([31337, 11155420, 421614]);
export const REVIEW_LOG = 'docs/compliance/review-log.md';
export const PRESETS_FILE = 'config/chain-presets.json';
export const WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

const RECORD = /^contracts\/deployments\/([1-9][0-9]*)\.json$/;
// "## YYYY-MM-DD: kind[, kind] (reviewer: who)"
const ENTRY = /^## (\d{4}-\d{2}-\d{2}): ([a-z0-9-]+(?:, *[a-z0-9-]+)*) \(reviewer: ([^)]*\S[^)]*)\)\s*$/;

export function deploymentChainId(path) {
  const m = RECORD.exec(path);
  return m ? Number(m[1]) : null;
}

export function parseDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s) return null;
  return t;
}

export function parseReviewLog(text) {
  const out = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = ENTRY.exec(line);
    if (!m || parseDate(m[1]) === null) continue;
    out.push({ date: m[1], kinds: m[2].split(',').map((k) => k.trim()), reviewer: m[3].trim() });
  }
  return out;
}

export function launchRecordPath(chainId, presets) {
  const p = (presets?.presets ?? []).find((x) => x.chainId === chainId);
  return p ? `docs/reviews/launch-${p.name}.md` : null;
}

export function evaluate({ added, reviewLog, presets, exists, today }) {
  const mainnet = [...new Set(added)]
    .map((f) => ({ file: f, chainId: deploymentChainId(f) }))
    .filter((r) => r.chainId !== null && !NON_MAINNET_CHAIN_IDS.has(r.chainId));
  if (mainnet.length === 0) return { ok: true, mainnet, message: 'No mainnet deployment record added; nothing to gate.' };

  const errors = [];
  for (const r of mainnet) {
    const launch = launchRecordPath(r.chainId, presets);
    if (!launch) {
      errors.push(`${r.file}: chain ${r.chainId} is not a preset in ${PRESETS_FILE}, so it has no launch record path; add the preset (and its row in contracts/script/deploy.sh) first.`);
    } else if (!exists(launch)) {
      errors.push(`${r.file}: the launch record ${launch} does not exist. Write it before adding a mainnet deployment record.`);
    }
  }

  const now = parseDate(today);
  const gates = parseReviewLog(reviewLog).filter((e) => e.kinds.includes('mainnet-gate'));
  const fresh = gates.filter((e) => {
    const age = (now - parseDate(e.date)) / DAY_MS;
    return age >= 0 && age <= WINDOW_DAYS;
  });
  if (fresh.length === 0) {
    const last = gates.map((e) => e.date).sort().at(-1);
    errors.push(
      `${REVIEW_LOG} has no "mainnet-gate" entry dated within the last ${WINDOW_DAYS} days (today ${today}` +
        `${last ? `; latest ${last}` : '; none found'}). Add "## YYYY-MM-DD: mainnet-gate (reviewer: <name>)".`,
    );
  }

  const files = mainnet.map((r) => r.file).join(', ');
  if (errors.length) return { ok: false, mainnet, message: `Mainnet deployment record(s) added: ${files}\n  ${errors.join('\n  ')}` };
  return { ok: true, mainnet, message: `Mainnet gate passed for ${files} (mainnet-gate entry ${fresh.map((e) => e.date).sort().at(-1)}).` };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let input;
  try {
    const path = process.argv[2];
    if (!path || path.startsWith('--')) throw new Error('usage: mainnet-gate.mjs <added-files.txt> [--root DIR] [--today YYYY-MM-DD]');
    const root = arg('--root') ?? process.cwd();
    const today = arg('--today') ?? new Date().toISOString().slice(0, 10);
    if (parseDate(today) === null) throw new Error(`--today is not a valid YYYY-MM-DD date: ${today}`);
    const added = readFileSync(path, 'utf8').split(/[\0\n]/).filter(Boolean);
    if (added.some((f) => f.startsWith('"'))) throw new Error('quoted path in the file list (run git with -c core.quotePath=false -z)');
    const read = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : '');
    input = {
      added,
      reviewLog: read(REVIEW_LOG),
      presets: JSON.parse(read(PRESETS_FILE) || '{"presets":[]}'),
      exists: (p) => existsSync(join(root, p)),
      today,
    };
  } catch (e) {
    console.error(`mainnet-gate: ${e.message}`);
    process.exit(2);
  }
  const r = evaluate(input);
  if (!r.ok) {
    console.error('::error title=Mainnet gate::A mainnet deployment record needs a launch record and a recent mainnet-gate review');
    console.error(r.message);
    process.exit(1);
  }
  console.log(r.message);
}

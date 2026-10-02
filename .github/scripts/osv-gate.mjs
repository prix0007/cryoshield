#!/usr/bin/env node
// Dependency vulnerability gate over osv-scanner JSON output (OpenSpec change adopt-pr-workflow, decision 8;
// spec: ci-pipeline "Dependency vulnerability audit").
//
// osv-scanner has no severity threshold, so this script fails on any vulnerability group whose max CVSS is
// >= 7.0 (HIGH/CRITICAL) or unscored, and only reports the rest. It also lints the ignore file: only
// [[IgnoredVulns]] entries, each with an id, a reason and an ignoreUntil at most 90 days ahead.
//
// CLI: node osv-gate.mjs --config <osv-scanner.toml> --report <report.json> --scanner-exit <code> [--today YYYY-MM-DD]
// osv-scanner exits 0 (clean) or 1 (vulnerabilities found); anything else is a scanner error and fails.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const HIGH = 7.0;
const MAX_IGNORE_DAYS = 90;
const DAY_MS = 86_400_000;

export function evaluateReport(report) {
  const blocking = [];
  const advisory = [];
  for (const result of report?.results ?? []) {
    const src = basename(result?.source?.path ?? '?');
    for (const pkg of result?.packages ?? []) {
      const name = `${pkg?.package?.name}@${pkg?.package?.version}`;
      for (const group of pkg?.groups ?? []) {
        const score = Number.parseFloat(group?.max_severity);
        const ids = (group?.ids ?? []).join(', ');
        const scored = Number.isFinite(score);
        const line = `${name}  ${ids}  CVSS ${scored ? score.toFixed(1) : 'unscored'}  (${src})`;
        (!scored || score >= HIGH ? blocking : advisory).push(line);
      }
    }
  }
  return { ok: blocking.length === 0, blocking, advisory };
}

// Strict subset of TOML, so the lint and osv-scanner's real TOML parser can never disagree (security review
// HIGH-1: a multiline string could hide a second key from a line-based reader). Accepted lines only:
//   full-line comments, blank lines, `[[IgnoredVulns]]`, and inside an entry exactly one of each of
//   id = "<GHSA/CVE/OSV id>", reason = "<single-line basic string without \ or ">", ignoreUntil = YYYY-MM-DD[THH:MM:SSZ]
// No trailing comments, no multiline/literal strings, no other keys or tables. Anything else fails closed.
const VALUE = {
  id: /^"([A-Za-z0-9][A-Za-z0-9_.:-]*)"$/,
  reason: /^"([^"\\]*)"$/,
  ignoreUntil: /^(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z)?)$/,
};

export function lintIgnoreFile(text, today = new Date()) {
  const errors = [];
  const entries = [];
  let current = null;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    const where = `line ${i + 1}`;
    if (line === '' || line.startsWith('#')) return;
    if (line === '[[IgnoredVulns]]') {
      current = { line: i + 1 };
      entries.push(current);
      return;
    }
    if (line.startsWith('[')) {
      errors.push(`${where}: only [[IgnoredVulns]] tables are allowed (found ${line}); PackageOverrides would ignore whole packages`);
      current = null;
      return;
    }
    const kv = /^([A-Za-z0-9_]+) = (.+)$/.exec(line);
    if (!kv || current === null) {
      errors.push(`${where}: unexpected content outside an [[IgnoredVulns]] entry`);
      return;
    }
    const [, key, value] = kv;
    if (!(key in VALUE)) {
      errors.push(`${where}: unknown key '${key}' (allowed: id, reason, ignoreUntil)`);
      return;
    }
    if (key in current) {
      errors.push(`${where}: duplicate key '${key}' in the entry at line ${current.line}`);
      return;
    }
    const m = VALUE[key].exec(value);
    if (!m) {
      errors.push(`${where}: ${key} must match ${VALUE[key]} (single-line, no trailing comment)`);
      current[key] = '';
      return;
    }
    current[key] = m[1];
  });

  const limit = new Date(today.getTime() + MAX_IGNORE_DAYS * DAY_MS);
  for (const e of entries) {
    const at = `entry at line ${e.line}`;
    if (!e.id) errors.push(`${at}: missing id`);
    if (!e.reason || e.reason.trim() === '') errors.push(`${at}: missing reason`);
    if (!e.ignoreUntil) {
      errors.push(`${at}: missing ignoreUntil (exceptions must expire)`);
      continue;
    }
    const until = new Date(e.ignoreUntil);
    if (Number.isNaN(until.getTime()) || !/^\d{4}-\d{2}-\d{2}/.test(e.ignoreUntil)) {
      errors.push(`${at}: ignoreUntil "${e.ignoreUntil}" is not a date`);
    } else if (until > limit) {
      errors.push(`${at}: ignoreUntil ${e.ignoreUntil} is more than ${MAX_IGNORE_DAYS} days ahead`);
    }
  }
  return errors;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { values } = parseArgs({
    options: { config: { type: 'string' }, report: { type: 'string' }, 'scanner-exit': { type: 'string' }, today: { type: 'string' } },
  });
  if (!values.config || !values.report || values['scanner-exit'] === undefined) {
    console.error('usage: osv-gate.mjs --config <toml> --report <json> --scanner-exit <code> [--today YYYY-MM-DD]');
    process.exit(2);
  }
  let failed = false;

  const lint = lintIgnoreFile(readFileSync(values.config, 'utf8'), values.today ? new Date(values.today) : new Date());
  for (const e of lint) console.error(`::error title=osv-scanner ignore file::${values.config}: ${e}`);
  failed ||= lint.length > 0;

  const exit = Number(values['scanner-exit']);
  if (exit !== 0 && exit !== 1) {
    console.error(`::error title=osv-scanner::scanner failed with exit code ${exit}`);
    process.exit(1);
  }

  const r = evaluateReport(JSON.parse(readFileSync(values.report, 'utf8')));
  if (r.advisory.length) console.log(`Below the HIGH threshold (reported, not blocking):\n  ${r.advisory.join('\n  ')}`);
  if (r.blocking.length) {
    console.error('::error title=osv-scanner::HIGH/CRITICAL or unscored vulnerabilities in lockfiles');
    console.error(`Blocking (CVSS >= ${HIGH} or unscored):\n  ${r.blocking.join('\n  ')}`);
    console.error('Upgrade the dependency, or add a reviewed [[IgnoredVulns]] entry (reason + ignoreUntil <= 90 days).');
    failed = true;
  }
  if (failed) process.exit(1);
  console.log('osv-scanner gate: no HIGH/CRITICAL vulnerabilities');
}

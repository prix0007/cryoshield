#!/usr/bin/env node
// Trivy gate over `trivy <fs|image|config> --format json` reports (OpenSpec change add-trivy-scan, design D4;
// spec: ci-pipeline "Container image and filesystem vulnerability scan").
//
// Blocking: vulnerabilities at CRITICAL, HIGH or UNKNOWN severity (fail closed, like osv-gate's "unscored") and
// misconfigurations with status FAIL at CRITICAL or HIGH. MEDIUM and LOW are printed, not blocking. Trivy runs with
// --exit-code 0, so findings never fail trivy itself and a non-zero trivy exit is a scanner error (the step fails).
//
// The ignore file is Trivy's own .trivyignore.yaml format, applied by trivy (--ignorefile) and only linted here:
// top-level `vulnerabilities` and `misconfigurations` lists; each entry an id, a statement and an expired_at at most
// 90 days ahead (optional paths: list of strings); no anchors, aliases, explicit tags or second documents. Trivy drops
// an expired entry by itself, so the finding counts again. Every id must appear in README.md ("Known vulnerabilities").
//
// CLI: node trivy-gate.mjs --ignore <trivyignore.yaml> --readme <README.md> [--today YYYY-MM-DD] <report.json>...
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { LineCounter, isAlias, isMap, isScalar, isSeq, parseAllDocuments, visit } from 'yaml';

const MAX_IGNORE_DAYS = 90;
const DAY_MS = 86_400_000;
const BLOCKING_VULN = new Set(['CRITICAL', 'HIGH', 'UNKNOWN']);
const BLOCKING_MISCONF = new Set(['CRITICAL', 'HIGH']);
const KNOWN = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']);
const SECTIONS = ['vulnerabilities', 'misconfigurations'];
const ENTRY_KEYS = ['id', 'statement', 'expired_at', 'paths'];
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const severity = (s) => {
  const v = String(s ?? 'UNKNOWN').toUpperCase();
  return KNOWN.has(v) ? v : 'UNKNOWN';
};

export function evaluateReports(reports) {
  const blocking = new Set();
  const advisory = new Set();
  for (const report of reports) {
    for (const result of report?.Results ?? []) {
      const target = result?.Target ?? '?';
      for (const v of result?.Vulnerabilities ?? []) {
        const sev = severity(v?.Severity);
        const line = `${target}  ${v?.PkgName}@${v?.InstalledVersion}  ${v?.VulnerabilityID}  ${sev}  fix: ${v?.FixedVersion || 'none'}`;
        (BLOCKING_VULN.has(sev) ? blocking : advisory).add(line);
      }
      for (const m of result?.Misconfigurations ?? []) {
        if (m?.Status !== 'FAIL') continue;
        const sev = severity(m?.Severity);
        const line = `${target}  ${m?.ID}  ${sev}  ${m?.Title ?? ''}`.trimEnd();
        (BLOCKING_MISCONF.has(sev) ? blocking : advisory).add(line);
      }
    }
  }
  return { ok: blocking.size === 0, blocking: [...blocking], advisory: [...advisory] };
}

export function lintIgnoreFile(text, today = new Date()) {
  const errors = [];
  const ids = [];
  const lineCounter = new LineCounter();
  const docs = parseAllDocuments(text, { lineCounter, uniqueKeys: true });
  const lineOf = (node) => (node?.range ? lineCounter.linePos(node.range[0]).line : '?');
  const at = (node) => `line ${lineOf(node)}`;
  if (docs.length > 1) errors.push(`${at(docs[1].contents)}: only one document is allowed`);
  const doc = docs[0];
  if (!doc || doc.contents === null || doc.contents === undefined) return { errors, ids };
  for (const e of doc.errors) errors.push(`${e.linePos?.[0]?.line !== undefined ? `line ${e.linePos[0].line}` : 'parse'}: ${e.message.split('\n')[0]}`);
  for (const w of doc.warnings) errors.push(`${w.linePos?.[0]?.line !== undefined ? `line ${w.linePos[0].line}` : 'parse'}: ${w.message.split('\n')[0]}`);
  if (errors.length) return { errors, ids };

  // Structural rules first: anything a second parser could read differently fails closed.
  visit(doc, {
    Alias(_, node) { errors.push(`${at(node)}: aliases are not allowed`); },
    Node(_, node) {
      if (node.anchor) errors.push(`${at(node)}: anchors are not allowed`);
      if (node.tag) errors.push(`${at(node)}: explicit tags are not allowed`);
    },
  });
  if (errors.length) return { errors, ids };

  const root = doc.contents;
  if (!isMap(root)) {
    errors.push(`${at(root)}: the top level must be a mapping with the keys ${SECTIONS.join(' and ')}`);
    return { errors, ids };
  }
  const str = (node) => (isScalar(node) && typeof node.value === 'string' ? node.value : null);
  const limit = new Date(today.getTime() + MAX_IGNORE_DAYS * DAY_MS);
  const seen = new Set();
  for (const pair of root.items) {
    const key = str(pair.key);
    if (key === null || !SECTIONS.includes(key)) {
      errors.push(`${at(pair.key)}: unknown key '${str(pair.key) ?? '?'}' (allowed: ${SECTIONS.join(', ')})`);
      continue;
    }
    if (!isSeq(pair.value)) {
      errors.push(`${at(pair.key)}: '${key}' must be a list of entries`);
      continue;
    }
    for (const entry of pair.value.items) {
      if (!isMap(entry)) {
        errors.push(`${at(entry)}: each entry must be a mapping with id, statement and expired_at`);
        continue;
      }
      const fields = {};
      for (const p of entry.items) {
        const k = str(p.key);
        if (k === null || !ENTRY_KEYS.includes(k)) {
          errors.push(`${at(p.key)}: unknown key '${str(p.key) ?? '?'}' (allowed: ${ENTRY_KEYS.join(', ')})`);
          continue;
        }
        fields[k] = p;
      }
      const where = at(entry);
      if (!fields.id) errors.push(`${where}: missing id`);
      else {
        const id = str(fields.id.value);
        if (id === null || !ID.test(id)) errors.push(`${at(fields.id.value)}: id must match ${ID}`);
        else if (seen.has(id)) errors.push(`${at(fields.id.value)}: duplicate id ${id}`);
        else { seen.add(id); ids.push(id); }
      }
      if (!fields.statement) errors.push(`${where}: missing statement (why the finding is accepted)`);
      else {
        const s = str(fields.statement.value);
        if (s === null || s.trim() === '') errors.push(`${at(fields.statement.value)}: statement must be a non-empty string`);
      }
      if (!fields.expired_at) errors.push(`${where}: missing expired_at (exceptions must expire)`);
      else {
        const node = fields.expired_at.value;
        const raw = isScalar(node) ? String(node.source ?? node.value) : '';
        const until = new Date(`${raw}T00:00:00Z`);
        if (!DATE.test(raw) || Number.isNaN(until.getTime())) errors.push(`${at(node)}: expired_at must be a date, YYYY-MM-DD`);
        else if (until > limit) errors.push(`${at(node)}: expired_at ${raw} is more than ${MAX_IGNORE_DAYS} days ahead`);
      }
      if (fields.paths) {
        const node = fields.paths.value;
        if (!isSeq(node) || node.items.length === 0 || !node.items.every((i) => str(i) !== null && str(i).trim() !== '')) {
          errors.push(`${at(fields.paths.key)}: paths must be a non-empty list of strings`);
        }
      }
    }
  }
  return { errors, ids };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function checkReadme(text, ids, name = 'README.md') {
  const errors = [];
  for (const id of ids) {
    const re = new RegExp(`(^|[^A-Za-z0-9_.:-])${escapeRe(id)}(?![A-Za-z0-9_.:-])`, 'm');
    if (!re.test(text)) errors.push(`${name} does not list the excepted finding ${id} (add it to "Known vulnerabilities")`);
  }
  return errors;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { values, positionals } = parseArgs({
    options: { ignore: { type: 'string' }, readme: { type: 'string' }, today: { type: 'string' } },
    allowPositionals: true,
  });
  if (!values.ignore || !values.readme || positionals.length === 0) {
    console.error('usage: trivy-gate.mjs --ignore <trivyignore.yaml> --readme <README.md> [--today YYYY-MM-DD] <report.json>...');
    process.exit(2);
  }
  let failed = false;

  const lint = lintIgnoreFile(readFileSync(values.ignore, 'utf8'), values.today ? new Date(`${values.today}T00:00:00Z`) : new Date());
  for (const e of lint.errors) console.error(`::error title=trivy ignore file::${values.ignore}: ${e}`);
  failed ||= lint.errors.length > 0;

  const readme = checkReadme(readFileSync(values.readme, 'utf8'), lint.ids, values.readme);
  for (const e of readme) console.error(`::error title=trivy README record::${e}`);
  failed ||= readme.length > 0;

  const r = evaluateReports(positionals.map((f) => JSON.parse(readFileSync(f, 'utf8'))));
  if (r.advisory.length) console.log(`Below the HIGH threshold (reported, not blocking):\n  ${r.advisory.join('\n  ')}`);
  if (r.blocking.length) {
    console.error('::error title=trivy::CRITICAL/HIGH/unknown-severity vulnerabilities or CRITICAL/HIGH misconfigurations');
    console.error(`Blocking:\n  ${r.blocking.join('\n  ')}`);
    console.error('Upgrade the dependency or base image, or add a reviewed entry to .github/trivyignore.yaml (statement + expired_at <= 90 days) and list it in README.md.');
    failed = true;
  }
  if (failed) process.exit(1);
  console.log('trivy gate: no CRITICAL/HIGH/unknown findings');
}

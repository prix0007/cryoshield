#!/usr/bin/env node
// OpenSpec-first gate for pull requests (OpenSpec change adopt-pr-workflow, decision 5;
// spec: contribution-workflow "OpenSpec-first gate on pull requests").
//
// CLI: node openspec-gate.mjs <changed-files.txt>
//   changed-files: NUL- or newline-separated repo paths (git -c core.quotePath=false diff -z --name-only --no-renames BASE...HEAD)
//   env PR_LABELS: JSON array of label objects ({name}) or names; PR_BODY: PR description; PR_AUTHOR: login
// Exit: 0 pass, 1 gate failed, 2 bad input.
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';

// Code paths: product code, plus everything that defines how CI gates and builds it (security review MEDIUM-4:
// the gate, scanner configs, ruleset and root build config must not change without a spec either).
export const CODE_PREFIXES = ['apps/', 'packages/', 'contracts/src/', 'tools/recover/src/', 'tools/metrics/', '.github/', 'scripts/'];
export const CODE_FILES = ['.gitleaks.toml', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'contracts/foundry.toml'];
export const SPEC_PREFIX = 'openspec/changes/';
export const LABEL = 'no-spec';
export const JUSTIFICATION_MARKER = 'No-spec justification:';
const MIN_JUSTIFICATION = 10;

// Assumption A1: Dependabot may change dependency manifests (and action pins) without a spec change.
// Anchored to the manifests Dependabot is configured for (security review LOW-6), not to basenames.
const DEPENDABOT = 'dependabot[bot]';
const MANIFEST_PATTERNS = [
  /^(package\.json|pnpm-lock\.yaml)$/,
  /^(apps|packages)\/[^/]+\/package\.json$/,
  /^\.github\/(openspec-cli|scripts)\/package(-lock)?\.json$/,
  /^tools\/recover\/(pyproject\.toml|uv\.lock)$/,
  /^tools\/metrics\/package\.json$/,
  /^apps\/web\/deploy\/Dockerfile$/,
  /^\.github\/workflows\/[^/]+\.ya?ml$/,
];
const isManifest = (f) => MANIFEST_PATTERNS.some((re) => re.test(f));

const isCode = (f) => CODE_FILES.includes(f) || CODE_PREFIXES.some((p) => f.startsWith(p));
// git quotes unusual paths ("caf\303\251") unless core.quotePath=false; never guess, fail closed (review HIGH-2).
const isQuoted = (f) => f.startsWith('"');

export function justification(body) {
  const visible = String(body ?? '').replace(/<!--[\s\S]*?(-->|$)/g, '');
  for (const line of visible.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith(JUSTIFICATION_MARKER)) {
      const text = t.slice(JUSTIFICATION_MARKER.length).trim();
      if (text.replace(/\s/g, '').length >= MIN_JUSTIFICATION) return text;
    }
  }
  return null;
}

export function evaluate({ files, labels, body, author }) {
  const quoted = files.filter(isQuoted);
  if (quoted.length) {
    return {
      ok: false,
      codeFiles: quoted,
      message: `Changed-file list contains quoted paths (run git with -c core.quotePath=false -z):\n  ${quoted.join('\n  ')}`,
    };
  }
  const codeFiles = files.filter(isCode);
  if (codeFiles.length === 0) return { ok: true, codeFiles, message: 'No code paths changed; no OpenSpec change needed.' };

  const specFiles = files.filter((f) => f.startsWith(SPEC_PREFIX));
  if (specFiles.length > 0) {
    return { ok: true, codeFiles, message: `Code changes are accompanied by OpenSpec changes:\n  ${specFiles.join('\n  ')}` };
  }

  if (author === DEPENDABOT && files.every(isManifest)) {
    return { ok: true, codeFiles, message: 'Dependabot PR touching only dependency manifests; exempt (design A1).' };
  }

  const names = (labels ?? []).map((l) => (typeof l === 'string' ? l : l?.name));
  const reason = justification(body);
  if (names.includes(LABEL) && reason) {
    return { ok: true, codeFiles, message: `Exempt via '${LABEL}' label. Justification: ${reason}` };
  }

  const hint = names.includes(LABEL)
    ? `The '${LABEL}' label is set, but the PR description has no "${JUSTIFICATION_MARKER} <reason>" line (at least ${MIN_JUSTIFICATION} characters, outside HTML comments).`
    : `Add or update an OpenSpec change under ${SPEC_PREFIX} (see README "Contributing / PR workflow"), ` +
      `or set the '${LABEL}' label and fill in "${JUSTIFICATION_MARKER} <reason>" in the PR description.`;
  return {
    ok: false,
    codeFiles,
    message: `This PR changes code paths without an OpenSpec change:\n  ${codeFiles.join('\n  ')}\n${hint}`,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let input;
  try {
    const path = process.argv[2];
    if (!path) throw new Error('usage: openspec-gate.mjs <changed-files.txt>');
    const files = readFileSync(path, 'utf8').split(/[\0\n]/).filter(Boolean);
    const labels = JSON.parse(process.env.PR_LABELS ?? '[]');
    if (!Array.isArray(labels)) throw new Error('PR_LABELS must be a JSON array');
    input = { files, labels, body: process.env.PR_BODY ?? '', author: process.env.PR_AUTHOR ?? '' };
  } catch (e) {
    console.error(`openspec-gate: ${e.message}`);
    process.exit(2);
  }
  const r = evaluate(input);
  if (!r.ok) {
    console.error('::error title=OpenSpec gate::Code changes need an OpenSpec change or a justified no-spec label');
    console.error(r.message);
    process.exit(1);
  }
  console.log(r.message);
}

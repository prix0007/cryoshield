#!/usr/bin/env node
// Workflow security policy (OpenSpec change adopt-pr-workflow, decision 9; spec: ci-pipeline
// "CI supply-chain security"). Complements zizmor instead of duplicating it:
//   here:   no pull_request_target/workflow_run; top-level permissions exactly `contents: read` (or {}); every job declares
//           its own read-only permissions and timeout-minutes; no secrets context in PR-triggered workflows;
//           no inline `zizmor: ignore`; zizmor.yml keeps hash-pin for "*" and disables/ignores nothing.
//   zizmor: SHA pinning (via that hash-pin policy), persist-credentials (artipacked), template injection, etc.
//
// CLI: node workflow-policy.mjs [<.github dir>]   (default: .github)  exit 0 ok, 1 violations.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const FORBIDDEN_TRIGGERS = ['pull_request_target', 'workflow_run'];

function triggers(on) {
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.map(String);
  if (isObj(on)) return Object.keys(on);
  return [];
}

function strings(node, out = []) {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach((n) => strings(n, out));
  else if (isObj(node)) Object.entries(node).forEach(([k, v]) => { out.push(k); strings(v, out); });
  return out;
}

export function checkWorkflow(file, text) {
  const errors = [];
  if (/zizmor:\s*ignore/.test(text)) errors.push(`${file}: inline "zizmor: ignore" comments are not allowed; fix the finding instead`);

  let wf;
  try {
    wf = parse(text);
  } catch (e) {
    return [...errors, `${file}: cannot parse YAML (${e.message.split('\n')[0]})`];
  }
  if (!isObj(wf)) return [...errors, `${file}: not a workflow mapping`];

  const on = triggers(wf.on ?? wf.true);
  for (const t of FORBIDDEN_TRIGGERS) {
    if (on.includes(t)) errors.push(`${file}: the ${t} trigger is forbidden (privileged context reachable from fork PRs: write token and secrets)`);
  }

  const top = wf.permissions;
  const topOk = isObj(top) && (Object.keys(top).length === 0 || (Object.keys(top).length === 1 && top.contents === 'read'));
  if (!topOk) errors.push(`${file}: top-level permissions must be exactly "contents: read" (or {}), found ${JSON.stringify(top ?? null)}`);

  for (const [id, job] of Object.entries(isObj(wf.jobs) ? wf.jobs : {})) {
    if (!isObj(job)) continue;
    if (job.permissions === undefined) errors.push(`${file}: job '${id}' must declare its own permissions (least privilege)`);
    else if (!isObj(job.permissions)) {
      errors.push(`${file}: job '${id}' uses ${JSON.stringify(job.permissions)}; list only the scopes it needs (read-only)`);
    } else {
      // Read-only allow-list (security review MEDIUM-5). A job that needs a write scope needs a spec change here.
      for (const [scope, level] of Object.entries(job.permissions)) {
        if (level !== 'read' && level !== 'none') errors.push(`${file}: job '${id}' requests ${scope}: ${level}; only read/none is allowed (no write scopes)`);
      }
    }
    if (job['timeout-minutes'] === undefined && job.uses === undefined) {
      errors.push(`${file}: job '${id}' must set timeout-minutes`);
    }
  }

  if (on.includes('pull_request') || FORBIDDEN_TRIGGERS.some((t) => on.includes(t))) {
    // Any use of the secrets context inside an expression, whatever the case or form (secrets.X, secrets['X'],
    // toJSON(secrets), SECRETS.X), plus `secrets: inherit` (security review MEDIUM-3).
    const exprs = strings(wf).flatMap((s) => [...s.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].map((m) => m[1]));
    const hits = [...exprs.filter((e) => /\bsecrets\b/i.test(e)), ...strings(wf).filter((s) => s === 'inherit')];
    if (hits.length) errors.push(`${file}: secrets must not be referenced in a PR-triggered workflow (${hits.length} reference(s))`);
  }
  return errors;
}

export function checkZizmorConfig(text) {
  const errors = [];
  let cfg;
  try {
    cfg = parse(text) ?? {};
  } catch (e) {
    return [`zizmor.yml: cannot parse YAML (${e.message.split('\n')[0]})`];
  }
  const rules = isObj(cfg.rules) ? cfg.rules : {};
  const policies = rules['unpinned-uses']?.config?.policies;
  if (!isObj(policies) || policies['*'] !== 'hash-pin') {
    errors.push('zizmor.yml: rules.unpinned-uses.config.policies must map "*" to hash-pin');
  } else if (Object.keys(policies).length !== 1) {
    errors.push('zizmor.yml: unpinned-uses policies may only contain "*": hash-pin (no per-owner relaxations)');
  }
  for (const [name, rule] of Object.entries(rules)) {
    if (!isObj(rule)) continue;
    if (rule.disable) errors.push(`zizmor.yml: rule '${name}' must not be disabled`);
    if (rule.ignore !== undefined) errors.push(`zizmor.yml: rule '${name}' must not ignore findings`);
  }
  return errors;
}

export function checkGithubDir(dir) {
  const errors = [];
  const zizmor = join(dir, 'zizmor.yml');
  if (!existsSync(zizmor)) errors.push(`${zizmor}: missing (zizmor's hash-pin policy is part of this policy)`);
  else errors.push(...checkZizmorConfig(readFileSync(zizmor, 'utf8')));

  const wfDir = join(dir, 'workflows');
  const files = existsSync(wfDir) ? readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)).sort() : [];
  for (const f of files) errors.push(...checkWorkflow(join('workflows', f), readFileSync(join(wfDir, f), 'utf8')));
  return errors;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = process.argv[2] ?? '.github';
  const errors = checkGithubDir(dir);
  if (errors.length) {
    for (const e of errors) console.error(`::error title=workflow policy::${e}`);
    process.exit(1);
  }
  console.log(`workflow policy: OK (${dir})`);
}
